// src/pages/Chat.tsx
//
// Conversational UI on top of POST /chat.
//
// State model:
//   messages: an array of {role, content, sources?, grounded?} items.
//   Each new user question pushes one user message, then on response pushes
//   one assistant message. The whole list is re-rendered on every change —
//   for our message count (< 100) that's cheap.

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import type { ChatSource } from '../api/types';

interface UserMessage {
  role: 'user';
  content: string;
}
interface AssistantMessage {
  role: 'assistant';
  content: string;
  sources: ChatSource[];
  grounded: boolean;
}
type Message = UserMessage | AssistantMessage;

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to bottom whenever messages change.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || pending) return;
    setError(null);
    const userMsg: UserMessage = { role: 'user', content: question.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setPending(true);
    try {
      const res = await api.chat(userMsg.content);
      const aiMsg: AssistantMessage = {
        role: 'assistant',
        content: res.answer,
        sources: res.sources,
        grounded: res.grounded,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Chat failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 flex flex-col h-[calc(100vh-4rem)]">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold text-slate-900">Chat with your documents</h1>
        <p className="text-sm text-slate-600 mt-1">
          Answers come only from documents you uploaded. Out-of-scope questions return a refusal.
        </p>
      </header>

      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <p className="text-slate-400 text-center mt-10">
            Ask a question to get started.
          </p>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}
        {pending && (
          <div className="flex gap-2 items-center text-slate-500 text-sm">
            <span className="animate-pulse">●</span> Thinking…
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="my-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-4 flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a question…"
          maxLength={4000}
          disabled={pending}
          className="flex-1 rounded border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          disabled={pending || !question.trim()}
          className="rounded bg-indigo-600 text-white font-medium px-4 py-2 hover:bg-indigo-700 disabled:bg-indigo-300"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="rounded-2xl bg-indigo-600 text-white px-4 py-2 max-w-[80%] whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }
  // assistant
  const refusal = !message.grounded;
  return (
    <div className="flex justify-start">
      <div className={`max-w-[85%] space-y-2 ${refusal ? 'text-slate-500 italic' : ''}`}>
        <div className="rounded-2xl bg-white shadow-sm border border-slate-200 px-4 py-2 whitespace-pre-wrap">
          {message.content}
        </div>
        {message.sources.length > 0 && (
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer hover:text-slate-900">
              {message.sources.length} source{message.sources.length === 1 ? '' : 's'}
            </summary>
            <ul className="mt-2 space-y-1">
              {message.sources.map((s, i) => (
                <li key={i} className="rounded bg-slate-50 border border-slate-200 px-2 py-1">
                  <span className="font-medium">{s.filename}</span>
                  <span className="text-slate-500"> · chunk #{s.chunkIndex}</span>
                  <span className="text-slate-400"> · distance {s.distance.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
