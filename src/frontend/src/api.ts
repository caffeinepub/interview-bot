const APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycby_uGk_hH6z7gbF8-V7VkVha-qxse7n3vPyx8tMp3dzZNfSbT0QK4zMgmpRVihhwSYY/exec";

export interface Question {
  uid: string;
  srNo: number;
  questionType: string;
  question: string;
}

export interface InitInterviewResponse {
  candidateName: string;
  candidateEmail: string;
  department: string;
  designation: string;
  questions: Question[];
  maxSwitch: number;
}

async function post<T>(
  action: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" }, // text/plain avoids CORS preflight
    body: JSON.stringify({ action, ...params }),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid response from server. Please try again.");
  }
  // Return as-is; let the caller decide based on success/message fields
  return data as T;
}

// Maps to Apps Script action: sendOTP
export async function requestOtp(
  interviewId: string,
  email: string,
): Promise<{ success: boolean; message: string }> {
  return post("sendOTP", { interviewId, email });
}

// Maps to Apps Script action: verifyOTP
export async function verifyOtp(
  interviewId: string,
  email: string,
  otp: string,
): Promise<{ success: boolean; token: string; message: string }> {
  const res = await post<{ success: boolean; message: string }>("verifyOTP", {
    interviewId,
    email,
    otp,
  });
  return { ...res, token: interviewId };
}

// Maps to Apps Script action: getInterviewData
export async function initInterview(
  interviewId: string,
  _token: string,
): Promise<InitInterviewResponse> {
  const res = await post<{
    success: boolean;
    message?: string;
    candidate: { name: string; department: string; designation: string };
    questions: { uid: string; srNo: number; type: string; question: string }[];
  }>("getInterviewData", { interviewId });

  if (!res.success)
    throw new Error(res.message || "Failed to load interview data.");

  return {
    candidateName: res.candidate.name,
    candidateEmail: "",
    department: res.candidate.department,
    designation: res.candidate.designation,
    questions: res.questions.map((q) => ({
      uid: q.uid,
      srNo: q.srNo,
      questionType: q.type,
      question: q.question,
    })),
    maxSwitch: 10,
  };
}

export async function ttsSynthesize(
  _text: string,
  _token: string,
): Promise<{ audioBase64: string }> {
  return { audioBase64: "" };
}

export async function startResumableUpload(
  _interviewId: string,
  _token: string,
  _fileName: string,
  _fileSize: number,
): Promise<{ uploadId: string }> {
  return { uploadId: "local" };
}

export async function uploadChunk(
  _uploadId: string,
  _chunk: Blob,
  _chunkIndex: number,
  _totalChunks: number,
): Promise<{ success: boolean; progress: number }> {
  return { success: true, progress: 100 };
}

export async function uploadAudioToDrive(
  audioBlob: Blob,
  fileName: string,
): Promise<{ success: boolean; link: string }> {
  const base64 = await blobToBase64(audioBlob);
  return post("uploadAudio", {
    base64Data: base64,
    fileName,
    mimeType: audioBlob.type || "audio/webm",
  });
}

export async function finalizeInterview(
  interviewId: string,
  _token: string,
  screenSwitchCount: number,
  _selectedQuestionUIDs: string[],
  audioDriveLink?: string,
): Promise<{ success: boolean; audioLink: string }> {
  const res = await post<{ success: boolean; message: string }>("saveResult", {
    interviewId,
    audioDriveLink: audioDriveLink || "",
    screenSwitchCount,
    status: "COMPLETED",
  });
  return { success: res.success, audioLink: audioDriveLink || "" };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
