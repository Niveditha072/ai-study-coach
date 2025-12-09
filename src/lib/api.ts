import axios from "axios";

const API_URL = "http://localhost:8000";


// ------- AI Generate --------
export const generateStudyContent = async (text: string) => {
  const res = await axios.post(`${API_URL}/generate`, { text });
  return res.data;
};

// ------- Auth: Register -------
export const registerUser = async (username: string, password: string) => {
  const res = await axios.post(`${API_URL}/register`, { username, password });
  return res.data; // { token, username }
};

// ------- Auth: Login --------
export const loginUser = async (username: string, password: string) => {
  const res = await axios.post(`${API_URL}/login`, { username, password });
  return res.data; // { token, username }
};

// ------- SAVE Session --------
export const saveSession = async (token: string, content: any, title: string) => {
  const res = await axios.post(
    `${API_URL}/save_session`,
    { content, title },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    }
  );
  return res.data;
};

// ------- LOAD Last Session -------
export const fetchLastSession = async (token: string) => {
  const res = await axios.get(`${API_URL}/last_session`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  return res.data;
};

// ------- LOAD ALL Sessions -------
export const fetchAllSessions = async (token: string) => {
  const res = await axios.get(`${API_URL}/all_sessions`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.data;
};

// ------- DELETE Session -------
export const deleteSession = async (token: string, id: string) => {
  const res = await axios.delete(`${API_URL}/sessions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.data;
};

// ------- Download Flashcards PDF -------
export const downloadFlashcardsPdf = async (title: string, flashcards: any[]) => {
  const res = await axios.post(
    `${API_URL}/export_flashcards_pdf`,
    { title, flashcards },
    { responseType: "blob" }
  );
  return res.data;
};

// ------- Download Quiz PDF -------
export const downloadQuizPdf = async (title: string, quiz: any[]) => {
  const res = await axios.post(
    `${API_URL}/export_quiz_pdf`,
    { title, quiz },
    { responseType: "blob" }
  );
  return res.data;
};
