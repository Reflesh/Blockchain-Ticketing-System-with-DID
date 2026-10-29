import { TICKET_API_URL } from '@/constants/api';
import { authenticatedFetch } from '@/lib/sessionTransport';
import { fetchWithTimeout } from '@/lib/requestTimeout';

export type CommunityPost = {
  id: number;
  author: string;
  content: string;
  created_at: string;
  replies?: CommunityPost[];
  reply_count?: number;
};
export type CommunityPage = { data: CommunityPost[]; counts: { review: number; qna: number }; next_offset: number | null };

export async function getCommunity(eventId: string, kind: 'review' | 'qna', offset = 0, signal?: AbortSignal): Promise<CommunityPage> {
  const response = await fetchWithTimeout(`${TICKET_API_URL}/events/${encodeURIComponent(eventId)}/community?kind=${kind}&offset=${offset}`, { signal });
  if (!response.ok) throw new Error('게시글을 불러오지 못했습니다. 다시 시도해주세요.');
  return response.json();
}

export async function getCommunityReplies(eventId: string, postId: number, offset: number): Promise<CommunityPost[]> {
  const response = await fetchWithTimeout(`${TICKET_API_URL}/events/${encodeURIComponent(eventId)}/community/${postId}/replies?offset=${offset}`);
  if (!response.ok) throw new Error('답변을 불러오지 못했습니다.');
  return (await response.json()).data;
}

export async function createCommunityPost(eventId: string, kind: 'review' | 'qna' | 'reply', content: string, token: string, parentId?: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const url = `${TICKET_API_URL}/events/${encodeURIComponent(eventId)}/community${kind === 'reply' ? `/${parentId}/replies` : ''}`;
    const response = await authenticatedFetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(kind === 'reply' ? { content } : { kind, content }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.detail === 'string' ? body.detail : '글을 등록하지 못했습니다.');
    }
  } finally { clearTimeout(timer); }
}
