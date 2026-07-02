"use client"

import { useState } from "react"
import { ChatContainer } from "@/components/chat-container"
import { LandingPage } from "@/components/landing-page"

export default function Page() {
  const [showChat, setShowChat] = useState(false)

  if (showChat) {
    return (
      <main className="mx-auto h-dvh w-full max-w-2xl border-x border-border">
        <ChatContainer />
      </main>
    )
  }

  return <LandingPage onTryNow={() => setShowChat(true)} />
}
