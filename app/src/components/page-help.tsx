"use client"

import { HelpCircle } from "lucide-react"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription,
} from "@/components/ui/sheet"
import { pageHelpContent } from "@/lib/page-help-content"

interface PageHelpProps {
  pageKey: string
}

export function PageHelp({ pageKey }: PageHelpProps) {
  const content = pageHelpContent[pageKey]
  if (!content) return null

  return (
    <Sheet>
      <SheetTrigger
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        title="Справка по странице"
      >
        <HelpCircle className="size-4" />
      </SheetTrigger>
      <SheetContent side="right" className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{content.title}</SheetTitle>
          <SheetDescription>{content.subtitle}</SheetDescription>
        </SheetHeader>
        <div className="mt-4 space-y-4 text-sm">
          {content.sections.map((section, i) => (
            <div key={i}>
              {section.heading && (
                <h3 className="mb-1 font-semibold">{section.heading}</h3>
              )}
              {section.text && (
                <p className="text-muted-foreground leading-relaxed">{section.text}</p>
              )}
              {section.items && (
                <ul className="mt-1 space-y-1 text-muted-foreground">
                  {section.items.map((item, j) => (
                    <li key={j} className="flex gap-2">
                      <span className="shrink-0 text-primary">•</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  )
}
