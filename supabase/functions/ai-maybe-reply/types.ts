export type Message = {
  id: string;
  conversation_id: string;
  content: string | null;
  message_type: 'text' | 'audio' | 'image' | 'video' | 'document' | 'system';
  media_url?: string | null;
  sender_type: 'contact' | 'agent' | 'system';
  sent_at: string;
};

export type Contact = {
  id: string;
  name: string;
  phone: string | null;
  chat_lid: string | null;
  tags?: string[] | null;
};

export type Conversation = {
  id: string;
  contact_id: string;
  status: 'open' | 'resolved';
  assigned_to?: string | null;
  ai_mode: 'AUTO' | 'COPILOT' | 'OFF';
  human_control: boolean;
  typing_lock_until?: string | null;
};

export type Context = {
  conversationId: string;
  conversation?: Conversation;
  contact?: Contact;
  lastMessage?: Message;
  transcribedText?: string;
  aiResponseText?: string;
  skipReason?: string;
  supabaseUrl: string;
  supabaseServiceKey: string;
  settings?: any;
};

export type Middleware = (
  ctx: Context,
  next: () => Promise<void>
) => Promise<void>;