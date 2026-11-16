export interface AiStatus {
  image_service_enabled: boolean;
  chat_provider_configured: boolean;
}
export interface Prediction {
  class_id: number;
  label: string;
  label_vi: string;
  confidence: number;
}
export interface Diagnosis {
  id: string;
  zone_id: string | null;
  ai_predictions: Prediction[];
  user_feedback: boolean | null;
  created_at: string;
}
export interface Citation {
  document_id: string;
  filename: string;
  page: number;
  chunk_id: string;
  excerpt: string;
  source?: { filename: string; page: number; is_draft: boolean };
}
export interface ConversationSummary {
  id: string;
  session_title: string;
  message_count: number;
  updated_at: string;
}
export interface Conversation extends Omit<
  ConversationSummary,
  "message_count"
> {
  messages: {
    role: "user" | "assistant";
    content: string;
    citations: Citation[];
    created_at: string;
  }[];
}
export interface AiModel {
  classes: { class_id: number; label_vi: string }[];
}

export async function validateImage(file: File) {
  if (!file.size || file.size > 5 * 1024 * 1024)
    throw new Error("Chọn một ảnh JPEG hoặc PNG có dung lượng tối đa 5 MB.");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (value, index) => bytes[index] === value,
  );
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg)
    throw new Error(
      "Ảnh chưa đúng định dạng JPEG hoặc PNG. Vui lòng chọn ảnh khác.",
    );
}
