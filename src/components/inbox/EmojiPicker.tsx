import { useState } from 'react';
import { Smile } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const EMOJI_CATEGORIES = {
  'Frequentes': ['😀', '😂', '❤️', '👍', '🙏', '😊', '🔥', '💯', '✅', '👋'],
  'Rostos': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😗', '😙', '🤗', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐', '😯', '😪', '😫', '🥱', '😴', '😌', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🤫', '🤥', '😬', '😲', '🤯', '😵', '🥴', '😷', '🤒', '🤕'],
  'Gestos': ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐️', '🖖', '👋', '🤝', '🙏', '✍️', '💪', '🦾', '🖕', '👊', '✊', '🤛', '🤜', '👏', '🙌', '🤲'],
  'Símbolos': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '✨', '⭐', '🌟', '💫', '⚡', '🔥', '💯', '✅', '❌', '❓', '❗', '💤'],
};

interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
}

export function EmojiPicker({ onEmojiSelect }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<keyof typeof EMOJI_CATEGORIES>('Frequentes');

  const handleSelect = (emoji: string) => {
    onEmojiSelect(emoji);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="shrink-0">
          <Smile className="w-5 h-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start" side="top">
        {/* Category tabs */}
        <div className="flex gap-1 mb-2 border-b border-border pb-2 overflow-x-auto">
          {Object.keys(EMOJI_CATEGORIES).map((cat) => (
            <Button
              key={cat}
              variant={category === cat ? 'secondary' : 'ghost'}
              size="sm"
              className="text-xs whitespace-nowrap"
              onClick={() => setCategory(cat as keyof typeof EMOJI_CATEGORIES)}
            >
              {cat}
            </Button>
          ))}
        </div>
        
        {/* Emoji grid */}
        <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
          {EMOJI_CATEGORIES[category].map((emoji, idx) => (
            <button
              key={`${emoji}-${idx}`}
              className="w-8 h-8 flex items-center justify-center text-lg hover:bg-muted rounded transition-colors"
              onClick={() => handleSelect(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
