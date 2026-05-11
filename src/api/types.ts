export type SignupStatus = 'draft' | 'active' | 'archived' | 'canceled';

export interface SignupSlot {
  id?: string;
  title: string;
  capacity?: number;
  filled?: number;
  description?: string;
}

export interface Signup {
  id: string;
  slug: string;
  status: SignupStatus;
  title: string;
  description?: string;
  starts_at?: string;
  ends_at?: string;
  location?: string;
  slots?: SignupSlot[];
  url?: string;
  created_at: string;
  updated_at: string;
}

export interface Participant {
  id: string;
  signup_id: string;
  name: string;
  email?: string;
  slot?: number | string;
  items?: string;
  created_at: string;
}

export interface SignupAnalytics {
  signup_id: string;
  total_participants: number;
  capacity?: number;
  fill_rate?: number;
  slots?: { id?: string; title: string; filled: number; capacity?: number }[];
  views?: number;
}

export interface ListSignupsResponse {
  signups: Signup[];
}

export interface ListParticipantsResponse {
  participants: Participant[];
}

export interface AiDraftResponse {
  signup: Partial<Signup>;
}
