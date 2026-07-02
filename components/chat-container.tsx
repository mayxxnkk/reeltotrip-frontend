"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { ChatHeader } from "@/components/chat-header"
import { ChatInput } from "@/components/chat-input"
import { MessageBubble, type Message } from "@/components/message-bubble"
import { TypingIndicator } from "@/components/typing-indicator"
import { ScrollArea } from "@/components/ui/scroll-area"

function isReelUrl(text: string): boolean {
  try {
    const url = new URL(text.trim())
    return (
      url.hostname.includes("instagram.com") &&
      (url.pathname.includes("/reel") || url.pathname.includes("/p/"))
    )
  } catch {
    return text.includes("instagram.com")
  }
}

function stripMarkdown(text: string): string {
  return text.replace(/\*\*/g, "")
}

function formatSummary(raw?: string): string {
  if (!raw) return ""
  const lines = raw.split(/\r?\n/)
  const formatted: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { formatted.push(""); continue }
    const dayMatch = trimmed.match(/^\*\s*\*\*(Day\s*\d+[^*]*?)\*\*/i)
    if (dayMatch) {
      if (formatted.length && formatted[formatted.length - 1] !== "") formatted.push("")
      formatted.push(dayMatch[1].toUpperCase())
      continue
    }
    const headingMatch = trimmed.match(/^\*\*\s*(.+?)\s*\*\*:?$/)
    if (headingMatch) {
      if (formatted.length && formatted[formatted.length - 1] !== "") formatted.push("")
      formatted.push(headingMatch[1].toUpperCase())
      continue
    }
    if (trimmed.startsWith("*")) {
      formatted.push(`- ${stripMarkdown(trimmed.replace(/^\*\s*/, ""))}`)
      continue
    }
    formatted.push(stripMarkdown(trimmed))
  }
  return formatted.join("\n")
}

// State machine for the conversation flow
type FlowState =
  | "idle"                   // no reel sent yet
  | "awaiting_destination"   // reel sent, waiting for user to type destination
  | "active"                 // conversation running normally

export function ChatContainer() {
  const [messages, setMessages] = useState<Message[]>(() => [
    {
      id: "1",
      text: "Hey! Send me an Instagram reel of a place you'd like to visit and I'll plan a trip for you.",
      sender: "bot",
      timestamp: new Date(),
    },
  ])
  const [isTyping, setIsTyping] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [flowState, setFlowState] = useState<FlowState>("idle")
  const [pendingReelUrl, setPendingReelUrl] = useState<string | null>(null)
  const [pendingInferredDestination, setPendingInferredDestination] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  function addBotMessage(text: string) {
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      text,
      sender: "bot",
      timestamp: new Date(),
    }])
  }

  async function callPipeline(reelUrl: string, destination?: string) {
    setIsTyping(true)
    try {
      // Start the pipeline job
      const response = await fetch("https://reeltotrip-backend.onrender.com/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reelUrl, currency: "USD", ...(destination ? { destination } : {}) }),
      })

      if (!response.ok) throw new Error("Pipeline request failed")

      const { jobId } = await response.json()
      if (!jobId) throw new Error("No jobId returned")

      // Poll for result every 5 seconds (pipeline takes 1-3 min)
      const maxAttempts = 40 // 40 × 5s = 200s max wait
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise(r => setTimeout(r, 5000))
        const poll = await fetch(`https://reeltotrip-backend.onrender.com/pipeline/status/${jobId}`)
        const data = await poll.json()

        if (data.status === "done") {
          if (data.conversationId) setConversationId(data.conversationId)
          addBotMessage(formatSummary(data.summary) || "I couldn't generate a trip for that reel.")
          setFlowState("active")
          setIsTyping(false)
          return
        }
        if (data.status === "error") {
          throw new Error(data.error || "Pipeline failed")
        }
        // still pending — keep polling
      }
      throw new Error("Pipeline timed out")
    } catch {
      addBotMessage("Something went wrong while processing that reel. Please check the link and make sure the server is running.")
      setFlowState("idle")
      setPendingReelUrl(null)
    } finally {
      setIsTyping(false)
    }
  }

  async function callConversation(message: string) {
    if (!conversationId) return
    setIsTyping(true)
    try {
      const response = await fetch("https://reeltotrip-backend.onrender.com/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message, currency: "USD" }),
      })
      if (!response.ok) throw new Error("Conversation request failed")
      const data: { summary?: string } = await response.json()
      addBotMessage(formatSummary(data.summary) || "I couldn't process that request.")

      // If user wants to send a new reel, reset so the next URL starts fresh
      const lower = message.toLowerCase()
      const wantsNewReel = ["another reel", "new reel", "send a reel", "different reel", "one more reel"].some(p => lower.includes(p))
      if (wantsNewReel) {
        setFlowState("idle")
        setConversationId(null)
      }
    } catch {
      addBotMessage("Something went wrong. Please try again.")
    } finally {
      setIsTyping(false)
    }
  }

  async function handleSend(text: string) {
    // Add user message to UI
    setMessages(prev => [...prev, {
      id: crypto.randomUUID(),
      text,
      sender: "user",
      timestamp: new Date(),
    }])

    // ── Flow: user is providing the destination after we asked ──
    if (flowState === "awaiting_destination" && pendingReelUrl) {
      // If user sends another reel URL, treat it as the new reel
      if (isReelUrl(text)) {
        setPendingReelUrl(text.trim())
        setPendingInferredDestination(null)
        addBotMessage(
          "Got a new reel! Which destination is this one about? (e.g. \"Bali, Indonesia\" or just \"Bali\")"
        )
        return
      }

      // Use Groq to understand what the user actually means
      setIsTyping(true)
      try {
        const groqRes = await fetch("https://reeltotrip-backend.onrender.com/clarify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, inferredDestination: pendingInferredDestination }),
        })

        if (groqRes.ok) {
          const data = await groqRes.json()
          if (data.destination) {
            // Got a clear destination — run the pipeline
            const dest = data.destination
            const reel = pendingReelUrl
            setPendingReelUrl(null)
            setPendingInferredDestination(null)
            setIsTyping(false)
            await callPipeline(reel, dest)
          } else {
            // Bot needs more clarification
            addBotMessage(data.reply || "Could you tell me which destination this reel is about?")
            setIsTyping(false)
          }
        } else {
          addBotMessage("Could you tell me which destination this reel is about? (e.g. \"Rome, Italy\")")
          setIsTyping(false)
        }
      } catch {
        addBotMessage("Could you tell me which destination this reel is about? (e.g. \"Rome, Italy\")")
        setIsTyping(false)
      }
      return
    }

    // ── Flow: user sent a reel URL ──
    if (isReelUrl(text)) {
      setPendingReelUrl(text.trim())
      setPendingInferredDestination(null)
      setIsTyping(true)

      // Try to get a destination guess from context + Groq
      try {
        const res = await fetch("https://reeltotrip-backend.onrender.com/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reelUrl: text.trim(),
            conversationHint: conversationId
              ? messages
                  .filter(m => m.sender === "user")
                  .map(m => m.text)
                  .join(" ")
              : "",
          }),
        })
        const data = await res.json()
        const destination: string | null = data?.destination
        const confidence: string = data?.confidence ?? "low"

        if (
          destination &&
          destination !== "Unknown Destination" &&
          destination !== "Unknown" &&
          confidence !== "low"
        ) {
          setPendingInferredDestination(destination)
          addBotMessage(
            `Got the reel! Is this about **${destination}**? Reply "yes" to confirm, or type the correct destination.`
          )
        } else if (destination && destination !== "Unknown Destination" && destination !== "Unknown") {
          setPendingInferredDestination(destination)
          addBotMessage(
            `Got the reel! I think this might be about **${destination}** — is that right? Reply "yes" or type the correct destination.`
          )
        } else {
          addBotMessage(
            "Got the reel! I couldn't identify the destination from the link. Which place is this reel about?"
          )
        }
      } catch {
        addBotMessage("Got the reel! Which destination is this reel about?")
      } finally {
        setIsTyping(false)
        setFlowState("awaiting_destination")
      }
      return
    }

    // ── Flow: follow-up message in active conversation ──
    if (flowState === "active" && conversationId) {
      await callConversation(text)
      return
    }

    // ── No active conversation and not a reel ──
    addBotMessage("Please start by sending an Instagram reel link so I can plan a trip for you.")
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <ChatHeader />
      <ScrollArea className="flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 px-4 py-4 md:px-6 md:py-6">
          <div className="flex flex-col items-center gap-2 pb-4 pt-2">
            <div className="flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent md:size-20">
              <span className="text-xl font-bold text-primary-foreground md:text-2xl">IG</span>
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">Instagram Bot</p>
              <p className="text-xs text-muted-foreground">Typically replies instantly</p>
            </div>
          </div>

          <div className="flex items-center gap-3 py-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Today</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {isTyping && <TypingIndicator />}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <ChatInput onSend={handleSend} disabled={isTyping} />
    </div>
  )
}
