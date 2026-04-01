"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { ChevronDownIcon, CheckIcon } from "lucide-react"

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  children: React.ReactNode
}

interface SelectContextType {
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
}

const SelectContext = React.createContext<SelectContextType | null>(null)

function useSelectContext() {
  const ctx = React.useContext(SelectContext)
  if (!ctx) throw new Error("Select components must be used within <Select>")
  return ctx
}

function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen }}>
      <div className="relative" data-slot="select-root">
        {children}
      </div>
    </SelectContext.Provider>
  )
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: "sm" | "default"
}) {
  const { open, setOpen } = useSelectContext()

  return (
    <button
      type="button"
      data-slot="select-trigger"
      data-size={size}
      onClick={() => setOpen(!open)}
      className={cn(
        "flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        size === "default" && "h-8",
        size === "sm" && "h-7 rounded-md",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
    </button>
  )
}

function SelectValue({ className, placeholder, ...props }: React.HTMLAttributes<HTMLSpanElement> & { placeholder?: string }) {
  const { value } = useSelectContext()

  return (
    <span
      data-slot="select-value"
      className={cn("flex flex-1 items-center gap-1.5 text-left truncate", !value && "text-muted-foreground", className)}
      {...props}
    >
      {value || placeholder}
    </span>
  )
}

function SelectContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const { open, setOpen } = useSelectContext()
  const ref = React.useRef<HTMLDivElement>(null)

  // Click outside to close
  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      // Close if click is outside the entire Select (trigger + content)
      const selectRoot = ref.current?.closest("[data-slot='select-root']") ?? ref.current?.parentElement?.parentElement
      if (selectRoot && !selectRoot.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    // Use setTimeout to avoid closing immediately from the trigger click
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", handleClick)
    }
  }, [open, setOpen])

  if (!open) return null

  return (
    <div
      ref={ref}
      data-slot="select-content"
      className={cn(
        "absolute left-0 top-full z-[100] mt-1 w-full min-w-36 overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 animate-in fade-in-0 zoom-in-95 slide-in-from-top-2",
        className
      )}
      {...props}
    >
      <div className="max-h-60 overflow-y-auto p-1">
        {children}
      </div>
    </div>
  )
}

function SelectItem({
  className,
  children,
  value: itemValue,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const { value, onValueChange, setOpen } = useSelectContext()
  const isSelected = value === itemValue

  return (
    <div
      data-slot="select-item"
      role="option"
      aria-selected={isSelected}
      onClick={() => {
        onValueChange(itemValue)
        setOpen(false)
      }}
      className={cn(
        "relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-2 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground",
        isSelected && "bg-accent/50",
        className
      )}
      {...props}
    >
      <span className="flex flex-1 items-center gap-2 truncate">{children}</span>
      {isSelected && (
        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
          <CheckIcon className="size-3.5" />
        </span>
      )}
    </div>
  )
}

function SelectGroup({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="select-group" className={cn("p-1", className)} {...props} />
}

function SelectLabel({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="select-label" className={cn("px-2 py-1 text-xs text-muted-foreground", className)} {...props} />
}

function SelectSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="select-separator" className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
