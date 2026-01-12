"use client";

import React, { useState, useRef } from 'react';
import { Send, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmojiPicker } from './EmojiPicker';
import { cn } from '@/lib/utils';

interface ChatInputAreaProps {
  onSendMessage: (content: string) => void;
  onSendFile?: (file: File) => void;
  isResolved: boolean;
  isMobile: boolean;
}

export function ChatInputArea({ onSendMessage, onSendFile, isResolved, isMobile }: ChatInputAreaProps) {
  const [message, setMessage] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (message.trim()) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items || !onSendFile) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Check if it's an image
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          // Create a named file with proper extension
          const extension = item.type.split('/')[1] || 'png';
          const namedFile = new File([file], `pasted-image-${Date.now()}.${extension}`, {
            type: file.type
          });
          onSendFile(namedFile);
        }
        return;
      }
    }
  };

  if (isResolved) {
    return (
      <div className={`p-3 border-t border-border bg-card ${isMobile ? 'pb-safe' : ''}`}>
        <div className="text-center text-muted-foreground text-sm py-2">
          Conversa resolvida. {!isMobile && 'Use o menu para reabrir.'}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3 border-t border-border bg-card ${isMobile ? 'pb-safe' : ''}`}>
      <div className="flex items-center gap-2">
        <EmojiPicker onEmojiSelect={(emoji) => setMessage(prev => prev + emoji)} />
        <Button variant="ghost" size="icon" className="shrink-0" onClick={() => fileInputRef.current?.click()}>
          <Paperclip className="w-5 h-5" />
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file && onSendFile) onSendFile(file);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
        <Input
          placeholder="Digite uma mensagem... (Ctrl+V para colar imagem)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          className="flex-1"
          autoComplete="off"
        />
        <Button
          onClick={handleSend}
          className={cn(
            "shrink-0 transition-opacity",
            !message.trim() && "opacity-50 pointer-events-none"
          )}
        >
          <Send className="w-5 h-5" />
        </Button>
      </div>
    </div>
  );
}
