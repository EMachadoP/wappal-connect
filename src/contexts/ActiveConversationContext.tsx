import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ActiveConversationContextType {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  // Adicionar outros estados globais da conversa aqui conforme necessário
}

const ActiveConversationContext = createContext<ActiveConversationContextType | undefined>(undefined);

export function ActiveConversationProvider({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  return (
    <ActiveConversationContext.Provider value={{ activeId, setActiveId }}>
      {children}
    </ActiveConversationContext.Provider>
  );
}

export function useActiveConversation() {
  const context = useContext(ActiveConversationContext);
  if (!context) throw new Error('useActiveConversation must be used within Provider');
  return context;
}