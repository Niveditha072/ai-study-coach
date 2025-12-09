"use client";

import { useState, useEffect } from "react";
import {
  generateStudyContent,
  registerUser,
  loginUser,
  fetchLastSession,
  saveSession,
  fetchAllSessions,
  deleteSession,
  downloadFlashcardsPdf,
  downloadQuizPdf,
} from "../lib/api";

export default function Home() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [quizState, setQuizState] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  // 🔐 Auth + persistence state
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [isRegister, setIsRegister] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);


  // generate title from input notes
  const makeTitleFromInput = (text: string) => {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return "Study material";
    const words = cleaned.split(" ");
    let title = words.slice(0, 8).join(" ");
    if (words.length > 8) title += "...";
    return title;
  };

  // 🔁 On first load: restore token + load last session + history
  useEffect(() => {
    const savedToken = localStorage.getItem("token");
    const savedUsername = localStorage.getItem("username");

    if (savedToken && savedUsername) {
      setToken(savedToken);
      setUsername(savedUsername);

      fetchLastSession(savedToken)
        .then((data) => {
          if (data?.content) {
            setResult(data.content);
            setQuizState([]);
            setInput(data.content.input_text || "");
          }
        })
        .catch((err) => console.error("Load session error:", err));

      fetchAllSessions(savedToken)
        .then((sessions) => setHistory(sessions))
        .catch((err) => console.error("History load error:", err));
    }
  }, []);

  // 🔐 Login / Register handler
  const handleAuth = async () => {
    try {
      let data;
      if (isRegister) {
        data = await registerUser(loginUsername, loginPassword);
      } else {
        data = await loginUser(loginUsername, loginPassword);
      }

      setToken(data.token);
      setUsername(data.username);
      localStorage.setItem("token", data.token);
      localStorage.setItem("username", data.username);

      const last = await fetchLastSession(data.token);
      if (last?.content) {
        setResult(last.content);
        setQuizState([]);
        setInput(last.content.input_text || "");
      } else {
        setResult(null);
        setQuizState([]);
        setInput("");
      }

      const all = await fetchAllSessions(data.token);
      setHistory(all);
    } catch (err: any) {
      console.error("Auth error:", err);
      alert(
        err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "Login/Register failed"
      );
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUsername(null);
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setResult(null);
    setQuizState([]);
    setHistory([]);
    setShowHistory(false);
    setInput("");
  };

  const handleGenerate = async () => {
    setLoading(true);

    try {
      const data = await generateStudyContent(input);
      let raw = data?.response || data;
      let parsed: any = null;

      if (typeof raw === "object") {
        parsed = raw;
      } else if (typeof raw === "string") {
        raw = raw.replace(/```json|```/g, "").trim();
        parsed = JSON.parse(raw);
      }

      // attach input_text into parsed so it's consistent
      if (parsed && typeof parsed === "object") {
        parsed.input_text = input;
      }

      setResult(parsed);
      setQuizState([]);

      // 💾 Save to backend if logged in and parsed exists
      if (parsed && token) {
        try {
          const title = makeTitleFromInput(input);
           await saveSession(token, parsed, title);
          console.log("Session saved.");

          const all = await fetchAllSessions(token);
          setHistory(all);
        } catch (err) {
          console.error("Save session error:", err);
        }
      }
    } catch (err) {
      console.error(err);
      alert("AI returned invalid JSON. Try again.");
    }

    setLoading(false);
  };

  const filteredHistory = history.filter((s: any) =>
    historySearch.trim()
      ? (s.title || "")
          .toLowerCase()
          .includes(historySearch.trim().toLowerCase())
      : true
  );

 // Helper to format title neatly in PDF
const wrapTitle = (doc: any, title: string) => {
  doc.setFontSize(18);
  doc.setFont("Helvetica", "bold");

  const wrappedTitle = doc.splitTextToSize(`Topic: ${title}`, 170);

  wrappedTitle.forEach((line: string, i: number) => {
    const lineWidth = doc.getTextWidth(line);
    const xPos = (doc.internal.pageSize.width - lineWidth) / 2;
    doc.text(line, xPos, 20 + i * 8);
  });

  // Divider under title
  const yOffset = 20 + wrappedTitle.length * 10;
  doc.setLineWidth(0.7);
  doc.line(20, yOffset, 190, yOffset);

  return yOffset + 10;
};

// 📄 Download Flashcards PDF
// 📄 Download Flashcards PDF (Clean + Wrapped)
const handleDownloadStudyBook = async () => {
  if (!history.length) {
    alert("No saved sessions found.");
    return;
  }

  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "a4" });

    const margin = 40;
    let y = margin;

    const wrapText = (text: string, width: number) => {
      return doc.splitTextToSize(text, width);
    };

    const safeTitle = "Study Book";

    doc.setFont("Helvetica", "bold");
    doc.setFontSize(20);
    doc.text(safeTitle, margin, y);
    y += 30;

    for (let i = 0; i < history.length; i++) {
      const session = history[i];

      doc.setFontSize(16);
      doc.setFont("Helvetica", "bold");

      // Session heading
      const formattedTitle = session.title?.trim() || `Session ${i + 1}`;
      const wrappedTitle = wrapText(formattedTitle, 515);
      wrappedTitle.forEach((line: string) => {
        if (y + 20 > 780) doc.addPage();
        doc.text(line, margin, y);
        y += 20;
      });
      y += 10;

      // FLASHCARDS
      if (session.content.flashcards?.length) {
        doc.setFontSize(14);
        doc.setFont("Helvetica", "bold");
        doc.text("Flashcards:", margin, y);
        y += 20;

        session.content.flashcards.forEach((card: any, index: number) => {
          doc.setFontSize(12);
          doc.setFont("Helvetica", "normal");

          const text = `Flashcard ${index + 1}\nQ: ${card.question}\nA: ${card.answer}`;
          const wrapped = wrapText(text, 515);

          wrapped.forEach((line: string) => {
            if (y + 15 > 780) {
              doc.addPage();
              y = margin;
            }
            doc.text(line, margin, y);
            y += 15;
          });

          y += 10;
        });
      }

      // QUIZZES
      if (session.content.quiz?.length) {
        doc.setFontSize(14);
        doc.setFont("Helvetica", "bold");
        if (y + 30 > 780) {
          doc.addPage();
          y = margin;
        }
        doc.text("Quiz:", margin, y);
        y += 20;

        session.content.quiz.forEach((q: any, index: number) => {
          doc.setFontSize(12);
          doc.setFont("Helvetica", "normal");
          const text = `Q${index + 1}: ${q.question}\nOptions:\n- ${q.options.join("\n- ")}\nAnswer: ${q.answer}`;
          const wrapped = wrapText(text, 515);

          wrapped.forEach((line: string) => {
            if (y + 15 > 780) {
              doc.addPage();
              y = margin;
            }
            doc.text(line, margin, y);
            y += 15;
          });

          y += 15;
        });
      }

      y += 20;
    }

    const filename = "Study-Book.pdf";
    doc.save(filename);
  } catch (error) {
    console.error("Error downloading study book:", error);
    alert("Failed to generate study book PDF.");
  }
};


const handleDownloadFlashcards = async () => {
  if (!result?.flashcards || !result.flashcards.length) {
    alert("No flashcards to export.");
    return;
  }

  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();

    const rawTitle = input.trim() || "Untitled Notes";
    const safeTitle =
      rawTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 30) || "Notes";

    // ---- TITLE ----
let y = 22;

doc.setFont("Times", "bolditalic");
doc.setFontSize(11);

const titleLines = doc.splitTextToSize(`Topic: ${rawTitle}`, 150);

titleLines.forEach((line: string) => {
  const x = (doc.internal.pageSize.width - doc.getTextWidth(line)) / 2;
  doc.text(line, x, y, { lineHeightFactor: 0.9 });
  y += 8; // tighter line spacing
});

// Divider
doc.setLineWidth(0.5);
doc.line(15, y, 195, y);
y += 8;


    // Divider
    doc.setLineWidth(0.5);
    doc.line(10, y, 200, y);
    y += 12;

    doc.setFont("Helvetica", "normal");
    doc.setFontSize(12);

    result.flashcards.forEach((card: any, i: number) => {

      // Page break check
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      // ---- QUESTION
      const qLine = `Q${i + 1}: ${card.question}`;
      const wrappedQ = doc.splitTextToSize(qLine, 180);
      doc.text(wrappedQ, 15, y);
      y += wrappedQ.length * 7 + 2;

      // ---- ANSWER
      const aLine = `A${i + 1}: ${card.answer}`;
      const wrappedA = doc.splitTextToSize(aLine, 180);
      doc.text(wrappedA, 20, y);

      y += wrappedA.length * 7 + 10;
    });

    doc.save(`${safeTitle}-Flashcards.pdf`);
  } catch (err) {
    console.error("Flashcards PDF error:", err);
    alert("Failed to download flashcards PDF.");
  }
};



// 📄 Download Quiz PDF (Clean Layout)
const handleDownloadQuiz = async () => {
  if (!result?.quiz?.length) {
    alert("No quiz to export.");
    return;
  }

  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();

    const rawTitle = input.trim() || "Study Notes";
    const safeTitle =
      rawTitle.replace(/[^a-zA-Z0-9 ]/g, "").trim().slice(0, 40) || "Notes";

    let y = 20;

    // ---- HEADER ----
doc.setFont("Helvetica", "bold");
doc.setFontSize(13); // reduced font size for cleaner look

const titleLines = doc.splitTextToSize(`Topic: ${rawTitle}`, 170);

titleLines.forEach((line: string) => {
  doc.text(line, 15, y, { lineHeightFactor: 0.9 }); 
  y += 9; // reduced spacing between lines
});

// Divider line
doc.setLineWidth(0.6);
doc.line(10, y + 2, 200, y + 2);
y += 14;

    // ---- CONTENT ----
    doc.setFont("Helvetica", "normal");
    doc.setFontSize(12);

    result.quiz.forEach((q: any, idx: number) => {

      // Page break
      if (y > 260) {
        doc.addPage();
        y = 20;
      }

      // ---------- QUESTION ----------
      const questionText = `${idx + 1}. ${q.question}`;
      const wrappedQuestion = doc.splitTextToSize(questionText, 180);
doc.text(wrappedQuestion, 15, y, { lineHeightFactor: 1.1 });
y += wrappedQuestion.length * 6 + 6;


      // ---------- OPTIONS ----------
      q.options.forEach((opt: string) => {
        const wrappedOption = doc.splitTextToSize(`• ${opt}`, 170);
        doc.text(wrappedOption, 22, y);
        y += wrappedOption.length * 6;
      });

      // ---------- ANSWER (FIXED WRAP) ----------
      doc.setFont("Helvetica", "bold");
      doc.setTextColor(34, 139, 34);

      const answer = `Correct Answer: ${q.answer}`;
      const wrappedAnswer = doc.splitTextToSize(answer, 180);
      doc.text(wrappedAnswer, 15, y);

      y += wrappedAnswer.length * 7 + 10;

      doc.setFont("Helvetica", "normal");
      doc.setTextColor(0, 0, 0);
    });

    // ---- SAVE FILE ----
    doc.save(`${safeTitle}-Quiz.pdf`);

  } catch (err) {
    console.error("Quiz PDF error:", err);
    alert("PDF export failed.");
  }
};

  // --------------------------------------------------------

  return (
    <main className="min-h-screen p-6 text-white bg-(--bg)">
      {/* LOGIN MODAL */}
{!username && showLoginModal && (
  <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm z-50">
    <div className="bg-[#111] p-6 rounded-xl border border-[#333] w-80 shadow-2xl">

      <h2 className="text-lg font-semibold mb-4 text-center text-(--accent)">
        {isRegister ? "Create Account" : "Welcome Back"}
      </h2>

      <input
        placeholder="Username"
        value={loginUsername}
        onChange={(e) => setLoginUsername(e.target.value)}
        className="w-full mb-3 px-3 py-2 rounded bg-black border border-[#333] text-sm"
      />

      <input
        placeholder="Password"
        type="password"
        value={loginPassword}
        onChange={(e) => setLoginPassword(e.target.value)}
        className="w-full mb-4 px-3 py-2 rounded bg-black border border-[#333] text-sm"
      />

      <button
        onClick={() => { handleAuth(); setShowLoginModal(false); }}
        className="w-full py-2 mb-3 rounded bg-(--accent) text-black font-semibold hover:shadow-lg transition"
      >
        {isRegister ? "Register" : "Login"}
      </button>

      <p className="text-center text-sm">
        <button
          onClick={() => setIsRegister(!isRegister)}
          className="text-blue-400 underline"
        >
          {isRegister ? "Already have an account? Login" : "New user? Register"}
        </button>
      </p>

      <button
        onClick={() => setShowLoginModal(false)}
        className="block mx-auto mt-4 text-gray-400 text-xs hover:text-white transition"
      >
        ✖ Close
      </button>
    </div>
  </div>
)}


      {/* 🔐 Top bar: Login / Logout */}
      {/* 🔐 Top Bar */}
<div className="flex justify-between items-center mb-4">
  {username ? (
    <div className="flex items-center gap-4">

      <span className="text-sm text-gray-100 opacity-80">👋 Hi, {username}</span>

      <button
        onClick={() => setShowHistory(!showHistory)}
        className="px-3 py-1 rounded bg-[#222] border border-[#444] hover:bg-[#333] text-xs transition"
      >
        📚 {showHistory ? "Hide History" : "Show History"}
      </button>

      <button
        onClick={handleLogout}
        className="px-3 py-1 rounded bg-red-500 text-white hover:bg-red-600 text-xs transition"
      >
        🚪 Logout
      </button>
    </div>
  ) : (
    <button
      onClick={() => {
        setIsRegister(false);
        setShowLoginModal(true);
      }}
      className="px-4 py-2 rounded bg-(--accent) hover:shadow-[0_0_15px_rgba(0,138,255,0.8)] transition active:scale-95 text-sm font-semibold"
    >
      🔐 Login / Register
    </button>
  )}
</div>

      {/* 🔍 History panel */}
      {username && showHistory && (
        <div className="mb-4 p-4 rounded bg-[#111] border border-[#333]">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Previous Sessions 📚</h2>
            <input
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              placeholder="Search by title..."
              className="px-2 py-1 rounded bg-black border border-[#444] text-sm"
            />
          </div>

          {filteredHistory.length === 0 && (
            <p className="text-sm text-gray-400">No sessions found.</p>
          )}

          {filteredHistory.map((s: any, index: number) => (
            <div
              key={s.id || index}
              className="flex items-center justify-between mb-2"
            >
              <button
                onClick={() => {
                  setResult(s.content);
                  setInput(s.input_text || "");
                  setQuizState([]);
                  setShowHistory(false);
                }}
                className="flex-1 text-left p-2 rounded bg-[#222] hover:bg-[#333] text-sm"
              >
                {s.title || `Session ${index + 1}`} —{" "}
                {s.created_at
                  ? new Date(s.created_at * 1000).toLocaleString()
                  : "No time"}
              </button>

              <button
                className="ml-2 text-xs text-red-400 underline"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!token) return;
                  const ok = confirm("Delete this session permanently?");
                  if (!ok) return;
                  try {
                    await deleteSession(token, s.id);
                    const all = await fetchAllSessions(token);
                    setHistory(all);
                  } catch (err) {
                    console.error("Delete session error:", err);
                    alert("Failed to delete session.");
                  }
                }}
              >
                Delete
              </button>
            </div>
          ))}

          {history.length > 0 && (
  <button
    onClick={handleDownloadStudyBook}
    className="mt-4 px-4 py-2 bg-(--accent) text-white rounded shadow hover:scale-95 transition"
  >
    📄 Download Study Book
  </button>
)}

        </div>
      )}

      {/* Heading */}
      <h1 className="text-4xl font-bold text-center text-(--accent) mb-6">
        AI Learning Coach 🤖🔥
      </h1>

      {/* Textarea */}
      <textarea
        placeholder="Paste your notes here..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        className="w-full h-52 p-4 rounded-xl text-lg bg-[#111] border border-[#222]
        focus:border-(--accent) transition shadow-md outline-none"
      />

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full p-4 mt-4 rounded-xl text-lg font-semibold bg-(--accent)
        hover:shadow-[0_0_25px_rgba(0,138,255,1)] transition active:scale-95"
      >
        {loading ? "Generating..." : "Generate Study Material"}
      </button>

      {/* PDF Buttons */}
      {result && (
        <div className="mt-4 flex flex-wrap gap-3">
          <button
            onClick={handleDownloadFlashcards}
            className="px-4 py-2 rounded-lg bg-[#222] border border-[#444] text-sm hover:bg-[#333]"
          >
            📄 Download Flashcards PDF
          </button>
          <button
            onClick={handleDownloadQuiz}
            className="px-4 py-2 rounded-lg bg-[#222] border border-[#444] text-sm hover:bg-[#333]"
          >
            📄 Download Quiz PDF
          </button>
        </div>
      )}
      

      {/* Flashcards */}
      {result?.flashcards && (
        <section className="mt-8">
          <h2 className="text-2xl font-semibold text-(--success) mb-1">
  Flashcards 🧠
</h2>
<p className="text-sm text-gray-400 mb-4 italic">
  Tap a card to reveal the answer ✨
</p>


          {result.flashcards.map((card: any, i: number) => {
            const flipped = quizState[i]?.flipped || false;

            const toggleFlip = () => {
              const updated = [...quizState];
              updated[i] = { ...updated[i], flipped: !flipped };
              setQuizState(updated);
            };

            return (
              <div
                key={i}
                className="relative w-full h-32 mb-4 cursor-pointer"
                onClick={toggleFlip}
              >
                <div className={`flip-card-inner ${flipped ? "flip" : ""}`}>
                  {/* Front */}
                  <div className="flip-card-front p-4 bg-(--card) border border-[#333] flex justify-center items-center rounded-xl text-(--accent)">
                    Q: {card.question}
                  </div>

                  {/* Back */}
                  <div className="flip-card-back p-4 bg-[#01314d] border border-(--accent) flex justify-center items-center rounded-xl font-bold text-(--success)">
                    {card.answer}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Quiz */}
      {result?.quiz && (
        <section className="mt-8">
          <h2 className="text-2xl font-semibold text-(--success) mb-3">
            Quiz 🎯
          </h2>

          {result.quiz.map((q: any, idx: number) => {
            const selected = quizState[idx]?.selected || null;
            const reveal = quizState[idx]?.showAnswer || false;

            const update = (key: string, val: any) => {
              const updated = [...quizState];
              updated[idx] = { ...updated[idx], [key]: val };
              setQuizState(updated);
            };

            return (
              <div key={idx} className="p-5 mb-4 bg-(--card) border border-[#333] rounded-xl">
                <p className="font-bold text-lg mb-2 text-(--accent)">
                  {idx + 1}. {q.question}
                </p>

                {q.options.map((opt: string, i: number) => (
                  <button
                    key={i}
                    onClick={() => update("selected", opt)}
                    className={`w-full p-3 text-left rounded-lg border mb-2 transition ${
                      selected === opt
                        ? "bg-blue-700 border-blue-400"
                        : "bg-[#111] border-[#333] hover:border-(--accent)"
                    }`}
                  >
                    • {opt}
                  </button>
                ))}

                {selected && (
                  <p
                    className={`mt-3 font-bold ${
                      selected === q.answer ? "text-(--success)" : "text-(--danger)"
                    }`}
                  >
                    {selected === q.answer ? "✅ Correct!" : "❌ Wrong"}
                  </p>
                )}

                {reveal && (
                  <p className="font-semibold text-[#0affb9] mt-2">
                    Correct Answer: {q.answer}
                  </p>
                )}

                <button
                  onClick={() => update("showAnswer", !reveal)}
                  className="mt-3 underline text-(--accent)"
                >
                  {reveal ? "Hide Answer" : "Show Answer"}
                </button>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}

