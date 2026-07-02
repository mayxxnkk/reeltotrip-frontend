"use client"

import { ArrowRight } from "lucide-react"

interface LandingPageProps {
  onTryNow: () => void
}

export function LandingPage({ onTryNow }: LandingPageProps) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center bg-background px-6 text-center">

      {/* Logo */}
      <div className="mb-6 flex size-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent">
        <span className="text-2xl font-bold text-white">RT</span>
      </div>

      {/* Title */}
      <h1 className="mb-3 text-3xl font-bold text-foreground md:text-4xl">
        ReelToTrip
      </h1>

      {/* Tagline */}
      <p className="mb-2 text-lg font-medium text-muted-foreground">
        Turn any Instagram travel reel into a trip plan
      </p>

      {/* Description */}
      <p className="mb-10 max-w-sm text-sm text-muted-foreground leading-relaxed">
        Paste a reel link and get a full day-by-day itinerary with attractions
        and budget estimates — powered by AI.
      </p>

      {/* CTA */}
      <button
        onClick={onTryNow}
        className="flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-accent px-8 py-3 text-sm font-semibold text-white shadow-md hover:opacity-90 transition-all hover:scale-105"
      >
        Try Now
        <ArrowRight className="size-4" />
      </button>

      {/* Subtle note */}
      <p className="mt-4 text-xs text-muted-foreground">Free · No sign-up required</p>

    </div>
  )
}
