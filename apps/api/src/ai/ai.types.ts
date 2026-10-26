import { ObjectId } from 'mongodb';
export interface Prediction { class_id: number; label: string; confidence: number }
export interface Diagnosis { _id: ObjectId; farmer_id: string; zone_id: string | null; image_url: string; image_file: string; mime: string;
  ai_predictions: Prediction[]; image_sha256: string; model_sha256: string; user_feedback: boolean | null; created_at: Date }
export interface Chunk { id: string; page: number; text: string }
export interface RagDocument { _id: ObjectId; filename: string; title: string; sha256: string; page_count: number; chunks: Chunk[];
  status: 'Active' | 'Inactive'; created_by: string; created_at: Date; updated_at: Date }
export interface Citation { document_id: string; filename: string; sha256: string; page: number; chunk_id: string; excerpt: string }
export interface ChatMessage { role: 'user' | 'assistant'; content: string; citations: Citation[]; created_at: Date }
export interface Conversation { _id: ObjectId; farmer_id: string; session_title: string; messages: ChatMessage[]; version: number; created_at: Date; updated_at: Date }
export interface Classification { task: 'classify'; model_sha256: string; predictions: Prediction[] }
export interface PdfPages { page_count: number; pages: { page: number; text: string }[] }
