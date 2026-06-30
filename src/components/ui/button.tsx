import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[#14B8A6] text-white hover:bg-[#14B8A6]/95 shadow-md shadow-[#14B8A6]/10",
        destructive:
          "bg-red-500 text-slate-50 hover:bg-red-500/90",
        outline:
          "border border-white/8 bg-transparent hover:bg-white/4 text-white",
        secondary:
          "bg-slate-100 text-slate-950 hover:bg-slate-100/80",
        ghost: "hover:bg-white/4 text-[#94A3B8] hover:text-white",
        link: "text-slate-900 underline-offset-4 hover:underline",
        gold: "bg-[#D4AF37] text-black hover:bg-[#D4AF37]/90 font-semibold shadow-md shadow-[#D4AF37]/10",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 width-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
