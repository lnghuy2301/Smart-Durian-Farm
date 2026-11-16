import { ConflictException } from '@nestjs/common';
import { BSON, Db, ObjectId } from 'mongodb';
import { Conversation, Diagnosis, RagDocument, ChatMessage } from './ai.types';

export abstract class AiStore {
  abstract addDiagnosis(value: Diagnosis): Promise<void>;
  abstract diagnosis(id: ObjectId, farmer: string): Promise<Diagnosis | null>;
  abstract deleteDiagnosis(id: ObjectId, farmer: string): Promise<boolean>;
  abstract diagnoses(farmer: string, offset: number, limit: number): Promise<{ items: Diagnosis[]; total: number }>;
  abstract feedback(id: ObjectId, farmer: string, value: boolean): Promise<boolean>;
  abstract addConversation(value: Conversation): Promise<void>;
  abstract conversation(id: ObjectId, farmer: string): Promise<Conversation | null>;
  abstract deleteConversation(id: ObjectId, farmer: string): Promise<boolean>;
  abstract conversations(farmer: string, offset: number, limit: number): Promise<{ items: Conversation[]; total: number }>;
  abstract append(id: ObjectId, farmer: string, version: number, pair: ChatMessage[], now: Date): Promise<boolean>;
  abstract addDocument(value: RagDocument): Promise<void>;
  abstract documents(activeOnly?: boolean): Promise<RagDocument[]>;
  abstract documentStatus(id: ObjectId, status: 'Active' | 'Inactive', now: Date): Promise<boolean>;
}
const copy = <T>(value: T): T => BSON.EJSON.parse(BSON.EJSON.stringify(value)) as T;
export class MemoryAiStore extends AiStore {
  private readonly images = new Map<string, Diagnosis>();
  private readonly chats = new Map<string, Conversation>();
  private readonly docs = new Map<string, RagDocument>();
  async addDiagnosis(v: Diagnosis) { this.images.set(v._id.toHexString(), copy(v)); }
  async diagnosis(id: ObjectId, user: string) { const v = this.images.get(id.toHexString()); return v?.farmer_id === user ? copy(v) : null; }
  async deleteDiagnosis(id: ObjectId, user: string) { const key = id.toHexString(); return this.images.get(key)?.farmer_id === user ? this.images.delete(key) : false; }
  async diagnoses(user: string, offset: number, limit: number) { return this.page([...this.images.values()].filter((v) => v.farmer_id === user), offset, limit); }
  async feedback(id: ObjectId, user: string, value: boolean) { const v = this.images.get(id.toHexString()); if (v?.farmer_id !== user) return false; v.user_feedback = value; return true; }
  async addConversation(v: Conversation) { this.chats.set(v._id.toHexString(), copy(v)); }
  async conversation(id: ObjectId, user: string) { const v = this.chats.get(id.toHexString()); return v?.farmer_id === user ? copy(v) : null; }
  async deleteConversation(id: ObjectId, user: string) { const key = id.toHexString(); return this.chats.get(key)?.farmer_id === user ? this.chats.delete(key) : false; }
  async conversations(user: string, offset: number, limit: number) { return this.page([...this.chats.values()].filter((v) => v.farmer_id === user), offset, limit); }
  async append(id: ObjectId, user: string, version: number, pair: ChatMessage[], now: Date) {
    const v = this.chats.get(id.toHexString());
    if (!v || v.farmer_id !== user || v.version !== version || v.messages.length > 198) return false;
    v.messages.push(...copy(pair)); v.version++; v.updated_at = now; return true;
  }
  async addDocument(v: RagDocument) { if ([...this.docs.values()].some((d) => d.sha256 === v.sha256)) throw new ConflictException('PDF đã được nhập'); this.docs.set(v._id.toHexString(), copy(v)); }
  async documents(activeOnly = false) { return copy([...this.docs.values()].filter((d) => !activeOnly || d.status === 'Active').slice(0, 101)); }
  async documentStatus(id: ObjectId, status: 'Active' | 'Inactive', now: Date) { const v = this.docs.get(id.toHexString()); if (!v) return false; v.status = status; v.updated_at = now; return true; }
  private page<T extends { _id: ObjectId; created_at: Date }>(items: T[], offset: number, limit: number) {
    items.sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || b._id.toHexString().localeCompare(a._id.toHexString()));
    return { items: copy(items.slice(offset, offset + limit)), total: items.length };
  }
}
export class MongoAiStore extends AiStore {
  private readonly images; private readonly chats; private readonly docs;
  constructor(db: Db) { super(); this.images = db.collection<Diagnosis>('AI_DISEASE_DIAGNOSTICS'); this.chats = db.collection<Conversation>('CHATBOT_CONVERSATIONS'); this.docs = db.collection<RagDocument>('AI_RAG_DOCUMENTS'); }
  async addDiagnosis(v: Diagnosis) { await this.images.insertOne(v); }
  async diagnosis(id: ObjectId, farmer: string) { return this.images.findOne({ _id: id, farmer_id: farmer }); }
  async deleteDiagnosis(id: ObjectId, farmer: string) { return (await this.images.deleteOne({ _id: id, farmer_id: farmer })).deletedCount === 1; }
  async diagnoses(farmer: string, offset: number, limit: number) { const filter = { farmer_id: farmer }; return { items: await this.images.find(filter).sort({ created_at: -1, _id: -1 }).skip(offset).limit(limit).toArray(), total: await this.images.countDocuments(filter) }; }
  async feedback(id: ObjectId, farmer: string, value: boolean) { return (await this.images.updateOne({ _id: id, farmer_id: farmer }, { $set: { user_feedback: value } })).matchedCount === 1; }
  async addConversation(v: Conversation) { await this.chats.insertOne(v); }
  async conversation(id: ObjectId, farmer: string) { return this.chats.findOne({ _id: id, farmer_id: farmer }); }
  async deleteConversation(id: ObjectId, farmer: string) { return (await this.chats.deleteOne({ _id: id, farmer_id: farmer })).deletedCount === 1; }
  async conversations(farmer: string, offset: number, limit: number) { const filter = { farmer_id: farmer }; return { items: await this.chats.find(filter).sort({ created_at: -1, _id: -1 }).skip(offset).limit(limit).toArray(), total: await this.chats.countDocuments(filter) }; }
  async append(id: ObjectId, farmer: string, version: number, pair: ChatMessage[], now: Date) {
    return (await this.chats.updateOne({ _id: id, farmer_id: farmer, version, 'messages.198': { $exists: false } }, { $push: { messages: { $each: pair } }, $inc: { version: 1 }, $set: { updated_at: now } })).modifiedCount === 1;
  }
  async addDocument(v: RagDocument) { try { await this.docs.insertOne(v); } catch (e) { if ((e as { code?: number }).code === 11000) throw new ConflictException('PDF đã được nhập'); throw e; } }
  async documents(activeOnly = false) { return this.docs.find(activeOnly ? { status: 'Active' } : {}).sort({ created_at: -1, _id: -1 }).limit(101).toArray(); }
  async documentStatus(id: ObjectId, status: 'Active' | 'Inactive', now: Date) { return (await this.docs.updateOne({ _id: id }, { $set: { status, updated_at: now } })).matchedCount === 1; }
}
