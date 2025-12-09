from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from dotenv import load_dotenv
from openai import OpenAI
import os, json, time, io
from pymongo import MongoClient
import bcrypt
import jwt
from bson import ObjectId
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4

# Load environment variables
load_dotenv()
MONGODB_URI = os.getenv("MONGODB_URI")
JWT_SECRET = os.getenv("JWT_SECRET", "supersecret")
JWT_ALGO = os.getenv("JWT_ALGO", "HS256")

mongo_client = MongoClient(MONGODB_URI)
db = mongo_client["ai_study_coach"]
users_col = db["users"]
sessions_col = db["sessions"]

# OpenRouter client
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

app = FastAPI(title="AI Study Coach API")

# CORS settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- MODELS ----------

class TextInput(BaseModel):
    text: str

class AuthInput(BaseModel):
    username: str
    password: str

class SessionInput(BaseModel):
    content: dict   # includes flashcards, quiz, input_text, etc.
    title: str | None = None

class Flashcard(BaseModel):
    question: str
    answer: str

class FlashcardsPDFRequest(BaseModel):
    title: str
    flashcards: list[Flashcard]

class QuizItem(BaseModel):
    question: str
    options: list[str]
    answer: str

class QuizPDFRequest(BaseModel):
    title: str
    quiz: list[QuizItem]


# ---------- AUTH HELPERS ----------

def create_token(user_id: str):
    payload = {
        "user_id": user_id,
        "exp": int(time.time()) + 60 * 60 * 24 * 7  # 7 days
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def get_current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=401, detail="No auth header")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header")
    
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("user_id")
    user = users_col.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user


# ---------- AUTH ROUTES ----------

@app.post("/register")
def register(data: AuthInput):
    existing = users_col.find_one({"username": data.username})
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")

    hashed = bcrypt.hashpw(data.password.encode("utf-8"), bcrypt.gensalt())

    result = users_col.insert_one({
        "username": data.username,
        "password_hash": hashed
    })

    token = create_token(str(result.inserted_id))
    return {"token": token, "username": data.username}


@app.post("/login")
def login(data: AuthInput):
    user = users_col.find_one({"username": data.username})
    if not user:
        raise HTTPException(status_code=400, detail="Invalid username or password")

    if not bcrypt.checkpw(data.password.encode("utf-8"), user["password_hash"]):
        raise HTTPException(status_code=400, detail="Invalid username or password")

    token = create_token(str(user["_id"]))
    return {"token": token, "username": user["username"]}


@app.get("/me")
def me(current_user = Depends(get_current_user)):
    return {"id": str(current_user["_id"]), "username": current_user["username"]}


# ---------- SESSIONS ----------

@app.post("/save_session")
def save_session(data: SessionInput, current_user = Depends(get_current_user)):
    user_id = str(current_user["_id"])

    title = (data.title or "").strip()
    if not title:
        title = "Untitled session"

    input_text = ""
    try:
        input_text = data.content.get("input_text", "")
    except Exception:
        input_text = ""

    sessions_col.insert_one(
        {
            "user_id": user_id,
            "title": title,
            "input_text": input_text,
            "content": data.content,
            "updated_at": time.time()
        }
    )
    return {"status": "saved"}


@app.get("/last_session")
def last_session(current_user = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    cursor = sessions_col.find({"user_id": user_id}).sort("updated_at", -1).limit(1)
    session = next(cursor, None)
    if not session:
        return {"content": None}
    return {"content": session["content"]}


@app.get("/all_sessions")
def all_sessions(current_user = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    cursor = sessions_col.find({"user_id": user_id}).sort("updated_at", -1)
    res = []
    for doc in cursor:
        res.append(
            {
                "id": str(doc["_id"]),
                "title": doc.get("title", "Untitled session"),
                "input_text": doc.get("input_text", ""),
                "content": doc["content"],
                "created_at": doc.get("updated_at", 0),
            }
        )
    return res


@app.delete("/sessions/{session_id}")
def delete_session(session_id: str, current_user = Depends(get_current_user)):
    user_id = str(current_user["_id"])
    result = sessions_col.delete_one(
        {"_id": ObjectId(session_id), "user_id": user_id}
    )
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# ---------- PDF HELPERS ----------

def _start_text_page(c):
    width, height = A4
    text = c.beginText(40, height - 60)
    text.setFont("Helvetica", 11)
    return text, width, height

def _flush_page(c, text):
    c.drawText(text)
    c.showPage()


@app.post("/export_flashcards_pdf")
def export_flashcards_pdf(data: FlashcardsPDFRequest):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    text, width, height = _start_text_page(c)

    # Header
    text.setFont("Helvetica-Bold", 14)
    text.textLine(f"Topic: {data.title}")
    text.moveCursor(0, 20)
    text.setFont("Helvetica-Bold", 12)
    text.textLine("Flashcards")
    text.moveCursor(0, 15)
    text.setFont("Helvetica", 11)

    y_limit = 40

    for i, fc in enumerate(data.flashcards, start=1):
        lines = [
            f"Q{i}: {fc.question}",
            f"A{i}: {fc.answer}",
            ""
        ]
        for line in lines:
            if text.getY() <= y_limit:
                _flush_page(c, text)
                text, width, height = _start_text_page(c)
            text.textLine(line)

    _flush_page(c, text)
    c.save()
    buffer.seek(0)

    headers = {
        "Content-Disposition": 'attachment; filename="flashcards.pdf"'
    }
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)


@app.post("/export_quiz_pdf")
def export_quiz_pdf(data: QuizPDFRequest):
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=A4)

    text, width, height = _start_text_page(c)

    # Header
    text.setFont("Helvetica-Bold", 14)
    text.textLine(f"Topic: {data.title}")
    text.moveCursor(0, 20)
    text.setFont("Helvetica-Bold", 12)
    text.textLine("Quiz")
    text.moveCursor(0, 15)
    text.setFont("Helvetica", 11)

    y_limit = 40

    for i, q in enumerate(data.quiz, start=1):
        lines = [f"{i}. {q.question}"]
        for idx, opt in enumerate(q.options):
            prefix = chr(ord("A") + idx)
            lines.append(f"   {prefix}) {opt}")
        lines.append(f"   Correct Answer: {q.answer}")
        lines.append("")

        for line in lines:
            if text.getY() <= y_limit:
                _flush_page(c, text)
                text, width, height = _start_text_page(c)
            text.textLine(line)

    _flush_page(c, text)
    c.save()
    buffer.seek(0)

    headers = {
        "Content-Disposition": 'attachment; filename="quiz.pdf"'
    }
    return StreamingResponse(buffer, media_type="application/pdf", headers=headers)


# ---------- BASIC + AI ----------

@app.get("/")
def home():
    return {"status": "Backend running 🚀"}


@app.post("/generate")
def generate(data: TextInput):

    prompt = f"""
You are an AI study assistant. Convert the notes below into structured study material.

RULES:
- Respond ONLY in VALID JSON.
- NO markdown.
- NO backticks.
- EXACTLY 6 flashcards and EXACTLY 6 quiz questions.
- Each quiz must have 4 options and only ONE correct answer.

OUTPUT FORMAT (follow EXACTLY):

{{
  "flashcards": [
    {{ "question": "?", "answer": "?" }},
    {{ "question": "?", "answer": "?" }},
    {{ "question": "?", "answer": "?" }},
    {{ "question": "?", "answer": "?" }},
    {{ "question": "?", "answer": "?" }},
    {{ "question": "?", "answer": "?" }}
  ],
  "quiz": [
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }},
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }},
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }},
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }},
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }},
    {{
      "question": "?",
      "options": ["A", "B", "C", "D"],
      "answer": "One option exactly as written"
    }}
  ]
}}

NOTES:
{data.text}
"""

    # ---- AI CALL ----
    response = client.chat.completions.create(
        model="deepseek/deepseek-chat",
        messages=[{"role": "user", "content": prompt}]
    )

    raw_output = response.choices[0].message.content.strip()

    raw_output = raw_output.replace("```json", "").replace("```", "").strip()

    try:
        parsed = json.loads(raw_output)
        return parsed
    except:
        return {"error": "AI returned invalid JSON", "raw": raw_output}
