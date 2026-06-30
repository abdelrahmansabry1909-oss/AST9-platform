import * as React from "react"
import { createRoot } from "react-dom/client"
import Feature108 from "@/components/blocks/shadcnblocks-com-feature108"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { 
  Activity, 
  ArrowUpRight, 
  Bot, 
  Calendar, 
  CheckCircle2, 
  ChevronDown, 
  ClipboardList, 
  Cpu, 
  Fingerprint, 
  HeartHandshake, 
  Sparkles, 
  X, 
  Zap 
} from "lucide-react"
import "@/styles/tailwind.css"

const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ5cXVva2hjYmFnb2ZzaHNjbGZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NzIxMjAsImV4cCI6MjA5MzM0ODEyMH0.wRJlvde8qm0TmFOQXZtAePwsb9F5djA5kdJlBzL3O1A';
const FN_URL = 'https://byquokhcbagofshsclfy.supabase.co/functions/v1/visitor-survey';
const CALENDLY_URL = 'https://calendly.com/abdelrahman-sabry-1909/talk-with-an-expert';

function LandingPage() {
  // Assessment Dropdown Toggle States
  const [navDropdownOpen, setNavDropdownOpen] = React.useState(false)
  const [heroDropdownOpen, setHeroDropdownOpen] = React.useState(false)
  const [ctaDropdownOpen, setCtaDropdownOpen] = React.useState(false)

  // Survey Modal States
  const [modalOpen, setModalOpen] = React.useState(false)
  const [surveyStep, setSurveyStep] = React.useState<"form" | "success">("form")
  const [loading, setLoading] = React.useState(false)
  const [errorMsg, setErrorMsg] = React.useState("")

  // Form Fields
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [symptoms, setSymptoms] = React.useState("")

  // Close menus on outside click
  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.nc-dropdown-container')) {
        setNavDropdownOpen(false)
        setHeroDropdownOpen(false)
        setCtaDropdownOpen(false)
      }
    }
    document.addEventListener("click", handleOutsideClick)
    return () => document.removeEventListener("click", handleOutsideClick)
  }, [])

  // Handle Survey Submit
  const handleSurveySubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg("")

    if (!fullName.trim() || fullName.length < 2) {
      setErrorMsg("Please enter your full name.")
      return
    }
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRe.test(email.trim().toLowerCase())) {
      setErrorMsg("Please enter a valid email address.")
      return
    }

    setLoading(true)
    const payload = {
      full_name: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim() || undefined,
      symptoms: symptoms.trim() || undefined,
      source: 'survey'
    }

    try {
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${SUPABASE_ANON}`
        },
        body: JSON.stringify(payload)
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Request failed (${res.status})`)
      }

      setSurveyStep("success")
    } catch (err: any) {
      console.error('[Visitor] survey submit failed:', err)
      setErrorMsg(err.message || 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const openSurveyFlow = () => {
    setNavDropdownOpen(false)
    setHeroDropdownOpen(false)
    setCtaDropdownOpen(false)
    setFullName("")
    setEmail("")
    setPhone("")
    setSymptoms("")
    setErrorMsg("")
    setSurveyStep("form")
    setModalOpen(true)
  }

  return (
    <div className="bg-[#07111A] min-h-screen text-[#F8FAFC] selection:bg-[#14B8A6]/30 selection:text-white relative font-sans overflow-x-hidden">
      {/* Decorative background grid and noise overlay */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />
      <div className="absolute top-0 left-0 right-0 h-[800px] bg-gradient-to-b from-[#14B8A6]/5 via-transparent to-transparent pointer-events-none blur-[120px]" />

      {/* ── NAVBAR ── */}
      <nav className="sticky top-0 z-40 bg-[#07111A]/80 backdrop-blur-md border-b border-white/5 py-4 px-6 transition-all duration-300">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <a href="#" className="flex items-center gap-3 group">
            <span className="w-9 h-9 flex-shrink-0">
              <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                <defs>
                  <linearGradient id="navLogoBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#1A2748"/><stop offset="1" stop-color="#0A1024"/></linearGradient>
                  <linearGradient id="navLogoGold" x1="10" y1="9" x2="30" y2="31" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#F6E27A"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#B8860B"/></linearGradient>
                </defs>
                <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="url(#navLogoBg)"/>
                <rect x="2.5" y="2.5" width="35" height="35" rx="10" fill="none" stroke="url(#navLogoGold)" stroke-width="1" opacity=".75"/>
                <path d="M13 28V13l14 14V12" fill="none" stroke="url(#navLogoGold)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                <circle cx="27" cy="12" r="2.6" fill="#2DD4BF"/>
                <circle cx="27" cy="12" r="5" fill="none" stroke="#2DD4BF" stroke-width="1" opacity=".5"/>
              </svg>
            </span>
            <span className="font-bold text-lg tracking-tight font-sans text-white group-hover:text-[#14B8A6] transition-colors">NEU<span className="text-[#14B8A6]">CORE</span></span>
          </a>

          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm font-medium text-[#94A3B8] hover:text-white transition-colors">Platform</a>
            <a href="#biomechanics" className="text-sm font-medium text-[#94A3B8] hover:text-white transition-colors">AI Intelligence</a>
            <a href="#telemetry" className="text-sm font-medium text-[#94A3B8] hover:text-white transition-colors">3D Telemetry</a>
            <a href="#about" className="text-sm font-medium text-[#94A3B8] hover:text-white transition-colors">Clinical Scope</a>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-sm font-semibold hidden sm:inline-flex" onClick={() => window.location.href='app.html?login=1'}>
              Sign In
            </Button>
            
            {/* Nav Assessment Dropdown */}
            <div className="relative nc-dropdown-container">
              <Button 
                variant="default" 
                className="text-sm font-bold bg-[#14B8A6] hover:bg-[#14B8A6]/90 text-white flex items-center gap-1.5"
                onClick={(e) => { e.stopPropagation(); setNavDropdownOpen(!navDropdownOpen); }}
              >
                Start Assessment <ChevronDown className="w-3.5 h-3.5" />
              </Button>
              {navDropdownOpen && (
                <div className="absolute right-0 mt-3 w-80 bg-slate-950/95 border border-white/8 rounded-2xl p-2.5 shadow-2xl backdrop-blur-xl animate-in fade-in-50 slide-in-from-top-3 duration-200 z-50">
                  <button 
                    onClick={() => { setNavDropdownOpen(false); window.open(CALENDLY_URL, '_blank', 'noopener'); }}
                    className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors"
                  >
                    <div className="bg-[#14B8A6]/10 p-2 rounded-lg text-[#14B8A6] mt-0.5">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-white">Talk with an Expert</span>
                      <span className="block text-xs text-[#94A3B8] mt-0.5">Book a 15-min consult with a NeuCore clinician.</span>
                    </div>
                  </button>
                  <button 
                    onClick={openSurveyFlow}
                    className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors mt-1"
                  >
                    <div className="bg-[#D4AF37]/10 p-2 rounded-lg text-[#D4AF37] mt-0.5">
                      <ClipboardList className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-white">Take a Quick Survey</span>
                      <span className="block text-xs text-[#94A3B8] mt-0.5">90 seconds — we'll match you to the right specialist.</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* ── HERO SECTION ── */}
      <header className="relative py-24 md:py-36 px-6 overflow-hidden">
        {/* Soft cyan glows */}
        <div className="absolute top-1/4 left-10 w-[320px] h-[320px] bg-[#67E8F9]/5 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
          <div className="lg:col-span-6 space-y-8 text-left">
            <Badge variant="gold" className="px-3 py-1 text-xs">
              <Zap className="w-3.5 h-3.5 mr-1 text-[#D4AF37] fill-[#D4AF37]/20" /> Advanced Neuro-Tech Protocol v3.8
            </Badge>
            
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] text-white">
              Rebuild Human <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#14B8A6] via-[#67E8F9] to-[#D4AF37]">Performance.</span>
            </h1>
            
            <p className="text-lg md:text-xl text-[#94A3B8] leading-relaxed max-w-xl">
              AI-powered biomechanics, movement intelligence, and neuro-performance optimization built for the future of rehabilitation and elite health.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4 relative nc-dropdown-container">
              <div className="relative">
                <Button 
                  size="lg" 
                  className="bg-[#14B8A6] hover:bg-[#14B8A6]/90 text-white font-bold h-12 px-8 flex items-center gap-2"
                  onClick={(e) => { e.stopPropagation(); setHeroDropdownOpen(!heroDropdownOpen); }}
                >
                  Start Assessment <ChevronDown className="w-4 h-4" />
                </Button>
                {heroDropdownOpen && (
                  <div className="absolute left-0 mt-3 w-80 bg-slate-950/95 border border-white/8 rounded-2xl p-2.5 shadow-2xl backdrop-blur-xl animate-in fade-in-50 slide-in-from-top-3 duration-200 z-50">
                    <button 
                      onClick={() => { setHeroDropdownOpen(false); window.open(CALENDLY_URL, '_blank', 'noopener'); }}
                      className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors"
                    >
                      <div className="bg-[#14B8A6]/10 p-2 rounded-lg text-[#14B8A6] mt-0.5">
                        <Calendar className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="block text-sm font-bold text-white">Talk with an Expert</span>
                        <span className="block text-xs text-[#94A3B8] mt-0.5">Book a 15-min consult with a NeuCore clinician.</span>
                      </div>
                    </button>
                    <button 
                      onClick={openSurveyFlow}
                      className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors mt-1"
                    >
                      <div className="bg-[#D4AF37]/10 p-2 rounded-lg text-[#D4AF37] mt-0.5">
                        <ClipboardList className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="block text-sm font-bold text-white">Take a Quick Survey</span>
                        <span className="block text-xs text-[#94A3B8] mt-0.5">90 seconds — we'll match you to the right specialist.</span>
                      </div>
                    </button>
                  </div>
                )}
              </div>
              <Button size="lg" variant="outline" className="border-white/10 hover:bg-white/5 text-white h-12 px-8" onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}>
                Explore Platform
              </Button>
            </div>

            {/* Micro trust metrics */}
            <div className="flex items-center gap-6 pt-8 border-t border-white/5">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#14B8A6]" />
                <span className="text-xs font-mono tracking-wider uppercase text-[#94A3B8]">FDA compliant guidelines</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-[#14B8A6]" />
                <span className="text-xs font-mono tracking-wider uppercase text-[#94A3B8]">HIPAA secure protocols</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-6 relative">
            {/* Holographic glowing wireframe dashboard card */}
            <div className="relative z-10 w-full max-w-lg mx-auto bg-slate-950/60 border border-white/8 p-6 md:p-8 rounded-3xl backdrop-blur-2xl shadow-2xl shadow-[#14B8A6]/5 overflow-hidden group">
              <div className="absolute -top-10 -right-10 w-44 h-44 bg-[#14B8A6]/10 rounded-full blur-[40px] pointer-events-none" />
              
              <div className="flex items-center justify-between mb-6 pb-4 border-b border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full bg-red-500/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                  <div className="w-3 h-3 rounded-full bg-green-500/80" />
                </div>
                <Badge variant="default" className="font-mono text-[10px]">SYSTEM STATUS: NOMINAL</Badge>
              </div>

              {/* Graphic Wireframe Grid Simulation */}
              <div className="w-full aspect-[4/3] rounded-xl bg-slate-950 border border-white/5 relative overflow-hidden flex flex-col justify-between p-4 mb-6">
                {/* Horizontal scanner light animation */}
                <div className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#14B8A6] to-transparent animate-[bounce_4s_infinite] pointer-events-none opacity-40" />

                {/* Grid Overlay */}
                <div className="absolute inset-0 bg-[radial-gradient(#ffffff03_1.5px,transparent_1.5px)] [background-size:16px_16px] pointer-events-none" />

                {/* Floating Telemetry Box */}
                <div className="relative z-10 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-mono tracking-wider uppercase text-[#94A3B8]">Telemetry Node</span>
                    <h4 className="text-sm font-bold text-white">Left Hip Rotation Angle</h4>
                  </div>
                  <span className="text-xs font-mono font-bold text-[#14B8A6] bg-[#14B8A6]/10 px-2 py-0.5 rounded border border-[#14B8A6]/20">ACTIVE</span>
                </div>

                {/* Simulated Wireframe Skeleton Vector Graphic */}
                <div className="w-full flex justify-center items-center h-32 relative">
                  <svg viewBox="0 0 100 120" className="w-32 h-32 opacity-80 filter drop-shadow-[0_0_12px_rgba(20,184,166,0.3)]">
                    {/* Head */}
                    <circle cx="50" cy="20" r="8" fill="none" stroke="#14B8A6" strokeWidth="1.5" />
                    {/* Spine */}
                    <line x1="50" y1="28" x2="50" y2="70" stroke="#14B8A6" strokeWidth="2" />
                    {/* Shoulders */}
                    <line x1="30" y1="35" x2="70" y2="35" stroke="#14B8A6" strokeWidth="1.5" />
                    {/* Left Arm */}
                    <line x1="30" y1="35" x2="22" y2="55" stroke="#14B8A6" strokeWidth="1.5" />
                    <line x1="22" y1="55" x2="16" y2="75" stroke="#14B8A6" strokeWidth="1" />
                    {/* Right Arm */}
                    <line x1="70" y1="35" x2="78" y2="55" stroke="#14B8A6" strokeWidth="1.5" />
                    <line x1="78" y1="55" x2="84" y2="75" stroke="#14B8A6" strokeWidth="1" />
                    {/* Pelvis */}
                    <line x1="35" y1="70" x2="65" y2="70" stroke="#67E8F9" strokeWidth="2" />
                    {/* Left Leg */}
                    <line x1="35" y1="70" x2="32" y2="92" stroke="#14B8A6" strokeWidth="2.2" />
                    <line x1="32" y1="92" x2="28" y2="114" stroke="#D4AF37" strokeWidth="1.8" />
                    {/* Right Leg */}
                    <line x1="65" y1="70" x2="68" y2="92" stroke="#14B8A6" strokeWidth="2.2" />
                    <line x1="68" y1="92" x2="72" y2="114" stroke="#14B8A6" strokeWidth="1.8" />
                    {/* Sensor Nodes */}
                    <circle cx="50" cy="48" r="2.5" fill="#67E8F9" />
                    <circle cx="35" cy="70" r="3" fill="#D4AF37" />
                    <circle cx="32" cy="92" r="2.5" fill="#14B8A6" />
                    <circle cx="68" cy="92" r="2.5" fill="#14B8A6" />
                  </svg>
                  
                  {/* Glowing text boxes pointing to skeleton */}
                  <div className="absolute top-2 left-6 bg-slate-900/90 border border-white/10 px-2 py-0.5 rounded text-[9px] font-mono text-white/80">
                    Hip Flex: -4.8°
                  </div>
                  <div className="absolute bottom-2 right-6 bg-slate-900/90 border border-white/10 px-2 py-0.5 rounded text-[9px] font-mono text-[#D4AF37]">
                    Tilt: +1.2°
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-[#94A3B8] border-t border-white/5 pt-3">
                  <span>90 fps Optical Tracking</span>
                  <span className="text-[#67E8F9]">Joint Symmetry: 96.2%</span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div className="bg-slate-900/40 border border-white/5 p-3.5 rounded-xl">
                  <span className="block text-[10px] uppercase font-semibold tracking-wider text-[#94A3B8] mb-1">Gait</span>
                  <span className="block text-base font-bold text-white">4.8 m/s</span>
                </div>
                <div className="bg-slate-900/40 border border-white/5 p-3.5 rounded-xl">
                  <span className="block text-[10px] uppercase font-semibold tracking-wider text-[#94A3B8] mb-1">Rotations</span>
                  <span className="block text-base font-bold text-[#14B8A6]">0.85 Hz</span>
                </div>
                <div className="bg-slate-900/40 border border-white/5 p-3.5 rounded-xl">
                  <span className="block text-[10px] uppercase font-semibold tracking-wider text-[#94A3B8] mb-1">Stress Max</span>
                  <span className="block text-base font-bold text-[#D4AF37]">620 N</span>
                </div>
              </div>
            </div>

            {/* Glowing background halo */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[110%] h-[110%] bg-radial-glow from-[#14B8A6]/5 to-transparent blur-[80px] pointer-events-none -z-10" />
          </div>
        </div>
      </header>

      {/* ── TRUST / STATS STRIP ── */}
      <section className="border-y border-white/5 py-12 bg-slate-950/20 backdrop-blur">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          <div className="space-y-1">
            <span className="block text-3xl md:text-4xl font-extrabold text-white">400k+</span>
            <span className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Joints Tracked</span>
          </div>
          <div className="space-y-1">
            <span className="block text-3xl md:text-4xl font-extrabold text-[#14B8A6]">&lt; 12ms</span>
            <span className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">AI Processing Latency</span>
          </div>
          <div className="space-y-1">
            <span className="block text-3xl md:text-4xl font-extrabold text-white">99.8%</span>
            <span className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Markerless Accuracy</span>
          </div>
          <div className="space-y-1">
            <span className="block text-3xl md:text-4xl font-extrabold text-[#D4AF37]">85+</span>
            <span className="block text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Elite Sports Franchises</span>
          </div>
        </div>
      </section>

      {/* ── FEATURE TABS SECTION ── */}
      <Feature108 />

      {/* ── BIOMECHANICS / AI SECTION ── */}
      <section className="py-20 md:py-28 relative overflow-hidden bg-slate-950/10" id="biomechanics">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-12 gap-16 items-center">
          <div className="lg:col-span-6 relative aspect-video rounded-3xl overflow-hidden border border-white/8 group">
            <div className="absolute inset-0 bg-gradient-to-r from-[#07111A]/90 via-transparent to-transparent z-10" />
            <img 
              src="https://images.unsplash.com/photo-1507668077129-56e32842fceb?q=80&w=800" 
              alt="Medical AI and Computer Vision" 
              className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-103"
            />
            <div className="absolute top-1/4 left-1/3 z-20 w-3 h-3 rounded-full bg-[#14B8A6] animate-ping" />
            <div className="absolute bottom-1/3 right-1/4 z-20 w-3 h-3 rounded-full bg-[#67E8F9] animate-ping" />
          </div>

          <div className="lg:col-span-6 space-y-8 text-left">
            <Badge variant="default">Biomechanical Intelligence</Badge>
            <h3 className="text-4xl font-bold text-white tracking-tight leading-tight">
              Optical Computer Vision. <br />
              <span className="text-[#14B8A6]">No Markers. No Wires.</span>
            </h3>
            <p className="text-base text-[#94A3B8] leading-relaxed">
              NeuCore converts standard smartphone or tablet video feeds into full-scale diagnostic laboratories. Automatically isolate joint kinematic chains during squats, gait cycles, or complex dynamic patterns.
            </p>

            <ul className="space-y-4">
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#14B8A6] mt-0.5" />
                <span className="text-[#94A3B8] text-sm"><strong className="text-white">Multi-Angle Synergy:</strong> Combine front, side, and rear video feeds dynamically.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#14B8A6] mt-0.5" />
                <span className="text-[#94A3B8] text-sm"><strong className="text-white">Autoload Corrections:</strong> Immediate suggestion of corrective routines based on asymmetry flags.</span>
              </li>
              <li className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#14B8A6] mt-0.5" />
                <span className="text-[#94A3B8] text-sm"><strong className="text-white">HIPAA Secure Vaults:</strong> All diagnostic video files are encrypted and processed client-side.</span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── NEUCORE 3D VISUAL SECTION ── */}
      <section className="py-20 md:py-28 relative overflow-hidden" id="telemetry">
        <div className="absolute top-1/3 right-10 w-[400px] h-[400px] bg-[#14B8A6]/5 rounded-full blur-[120px] pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-6">
          <div className="bg-gradient-to-b from-slate-950/60 to-slate-950/30 border border-white/8 p-8 md:p-16 rounded-[40px] backdrop-blur-2xl relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#14B8A6]/30 to-transparent" />
            
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              <div className="lg:col-span-7 space-y-6">
                <Badge variant="gold">Futuristic Biomechanics Suite</Badge>
                <h3 className="text-4xl font-extrabold text-white tracking-tight">
                  NeuCore 3D Engine
                </h3>
                <p className="text-[#94A3B8] leading-relaxed">
                  Experience interactive skeletal analysis in fully compiled three-dimensional rendering. Rotate joint vectors, track sagittal/frontal rotations, and analyze load displacement during exercise loads.
                </p>
                <div className="flex flex-wrap gap-4 pt-2">
                  <div className="flex items-center gap-2 bg-slate-900 border border-white/5 px-4 py-2.5 rounded-xl">
                    <Cpu className="w-4 h-4 text-[#14B8A6]" />
                    <span className="text-xs font-mono font-bold text-white">WebGL Rendering</span>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-900 border border-white/5 px-4 py-2.5 rounded-xl">
                    <Fingerprint className="w-4 h-4 text-[#D4AF37]" />
                    <span className="text-xs font-mono font-bold text-white">Kinematic Nodes</span>
                  </div>
                  <div className="flex items-center gap-2 bg-slate-900 border border-white/5 px-4 py-2.5 rounded-xl">
                    <Bot className="w-4 h-4 text-[#67E8F9]" />
                    <span className="text-xs font-mono font-bold text-white">Auto Deficit Alerts</span>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-5 relative aspect-square max-w-[340px] mx-auto rounded-full bg-slate-950 border border-[#14B8A6]/20 flex items-center justify-center p-8 overflow-hidden group">
                <div className="absolute inset-0 bg-[radial-gradient(#ffffff02_1px,transparent_1px)] [background-size:12px_12px]" />
                <div className="absolute inset-4 rounded-full border border-white/5 animate-[spin_10s_linear_infinite]" />
                <div className="absolute inset-8 rounded-full border border-[#14B8A6]/10 border-dashed animate-[spin_20s_linear_infinite]" />
                <div className="absolute inset-16 rounded-full border border-[#67E8F9]/5" />
                
                <span className="w-24 h-24 relative z-10 transition-transform duration-500 group-hover:scale-105">
                  <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                    <defs>
                      <linearGradient id="innerGlowBg" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#1A2748"/><stop offset="1" stop-color="#0A1024"/></linearGradient>
                      <linearGradient id="innerGlowGold" x1="10" y1="9" x2="30" y2="31" gradientUnits="userSpaceOnUse">
                        <stop stop-color="#F6E27A"/><stop offset=".5" stop-color="#D4AF37"/><stop offset="1" stop-color="#B8860B"/></linearGradient>
                    </defs>
                    <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="url(#innerGlowBg)"/>
                    <rect x="2.5" y="2.5" width="35" height="35" rx="10" fill="none" stroke="url(#innerGlowGold)" stroke-width="1" opacity=".75"/>
                    <path d="M13 28V13l14 14V12" fill="none" stroke="url(#innerGlowGold)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                    <circle cx="27" cy="12" r="2.6" fill="#2DD4BF"/>
                  </svg>
                </span>
                
                <div className="absolute inset-0 bg-gradient-to-t from-[#14B8A6]/10 to-transparent pointer-events-none blur-[40px] opacity-40" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA SECTION ── */}
      <section className="py-20 md:py-28 relative overflow-hidden border-t border-white/5" id="about">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-t from-[#14B8A6]/5 to-transparent pointer-events-none blur-[100px]" />
        
        <div className="max-w-4xl mx-auto text-center px-6 space-y-8 relative z-10">
          <Badge variant="gold" className="px-3 py-1">Ready for Transition</Badge>
          <h2 className="text-4xl md:text-6xl font-extrabold text-white tracking-tight leading-tight">
            Rebuild Human <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#14B8A6] via-[#67E8F9] to-[#D4AF37]">Performance Today.</span>
          </h2>
          <p className="text-lg text-[#94A3B8] leading-relaxed max-w-xl mx-auto">
            Experience clinical-grade biomechanical optimization and neuro-performance analytics, engineered to unlock peak longevity.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center pt-4 relative nc-dropdown-container">
            <div className="relative">
              <Button 
                size="lg" 
                className="bg-[#14B8A6] hover:bg-[#14B8A6]/90 text-white font-bold h-12 px-8 flex items-center gap-2"
                onClick={(e) => { e.stopPropagation(); setCtaDropdownOpen(!ctaDropdownOpen); }}
              >
                Start Assessment <ChevronDown className="w-4 h-4" />
              </Button>
              {ctaDropdownOpen && (
                <div className="absolute left-1/2 -translate-x-1/2 mt-3 w-80 bg-slate-950/95 border border-white/8 rounded-2xl p-2.5 shadow-2xl backdrop-blur-xl animate-in fade-in-50 slide-in-from-top-3 duration-200 z-50">
                  <button 
                    onClick={() => { setCtaDropdownOpen(false); window.open(CALENDLY_URL, '_blank', 'noopener'); }}
                    className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors"
                  >
                    <div className="bg-[#14B8A6]/10 p-2 rounded-lg text-[#14B8A6] mt-0.5">
                      <Calendar className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-white">Talk with an Expert</span>
                      <span className="block text-xs text-[#94A3B8] mt-0.5">Book a 15-min consult with a NeuCore clinician.</span>
                    </div>
                  </button>
                  <button 
                    onClick={openSurveyFlow}
                    className="w-full flex items-start gap-3 p-3 hover:bg-white/4 rounded-xl text-left transition-colors mt-1"
                  >
                    <div className="bg-[#D4AF37]/10 p-2 rounded-lg text-[#D4AF37] mt-0.5">
                      <ClipboardList className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="block text-sm font-bold text-white">Take a Quick Survey</span>
                      <span className="block text-xs text-[#94A3B8] mt-0.5">90 seconds — we'll match you to the right specialist.</span>
                    </div>
                  </button>
                </div>
              )}
            </div>
            <Button size="lg" variant="outline" className="border-white/10 hover:bg-white/5 text-white h-12 px-8" onClick={() => window.location.href='app.html?login=1'}>
              Sign In
            </Button>
          </div>
        </div>
      </section>

      {/* ── PREMIUM FOOTER ── */}
      <footer className="border-t border-white/5 bg-slate-950/40 py-16 px-6 relative z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-12">
          <div className="space-y-4">
            <a href="#" className="flex items-center gap-3">
              <span className="w-8 h-8">
                <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                  <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="url(#navLogoBg)"/>
                  <rect x="2.5" y="2.5" width="35" height="35" rx="10" fill="none" stroke="url(#navLogoGold)" stroke-width="1" opacity=".75"/>
                  <path d="M13 28V13l14 14V12" fill="none" stroke="url(#navLogoGold)" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="27" cy="12" r="2.6" fill="#2DD4BF"/>
                </svg>
              </span>
              <span className="font-bold tracking-tight text-white">NEU<span className="text-[#14B8A6]">CORE</span></span>
            </a>
            <p className="text-xs text-[#94A3B8] leading-relaxed">
              NeuCore is the future of human performance. Integrating computer vision biomechanics and nervous system analytics.
            </p>
          </div>

          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Platform</h4>
            <ul className="space-y-2.5 text-xs text-[#94A3B8]">
              <li><a href="#features" className="hover:text-white transition-colors">AI Gait Engine</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">CNS Synapse Feedback</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Kinematic Telemetry</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Security & Scope</h4>
            <ul className="space-y-2.5 text-xs text-[#94A3B8]">
              <li><a href="#" className="hover:text-white transition-colors">HIPAA Compliance</a></li>
              <li><a href="#" className="hover:text-white transition-colors">FDA Guidelines</a></li>
              <li><a href="#" className="hover:text-white transition-colors">Secure Biometric Vaults</a></li>
            </ul>
          </div>

          <div>
            <h4 className="text-xs font-bold text-white uppercase tracking-wider mb-4">Legal</h4>
            <ul className="space-y-2.5 text-xs text-[#94A3B8]">
              <li><a href="public/legal/terms.html" className="hover:text-white transition-colors">Terms of Service</a></li>
              <li><a href="public/legal/privacy.html" className="hover:text-white transition-colors">Privacy Policy</a></li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto pt-12 mt-12 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-6 text-[11px] font-mono text-[#94A3B8]">
          <span>© 2026 NeuCore Technologies. All rights reserved.</span>
          <div className="flex gap-6">
            <span>Powered by AST9 Engine</span>
            <span>FDA Compliant Pipeline</span>
          </div>
        </div>
      </footer>

      {/* ── VISITOR SURVEY MODAL ── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md transition-all duration-300 animate-in fade-in">
          <div className="w-full max-w-lg bg-slate-900/90 border border-white/10 rounded-3xl p-6 md:p-8 relative shadow-2xl backdrop-blur-xl animate-in scale-in-95 duration-200">
            <button 
              onClick={() => setModalOpen(false)}
              className="absolute top-4 right-4 text-[#94A3B8] hover:text-white p-1 rounded-full hover:bg-white/5 transition-colors"
              aria-label="Close survey"
            >
              <X className="w-5 h-5" />
            </button>

            {surveyStep === "form" ? (
              <form onSubmit={handleSurveySubmit} className="space-y-6">
                <div>
                  <Badge variant="gold" className="mb-2">Assessment Survey</Badge>
                  <h3 className="text-2xl font-bold text-white">Start Your Biomechanics Intake</h3>
                  <p className="text-xs text-[#94A3B8] mt-1">Provide your details to match with a specialist.</p>
                </div>

                {errorMsg && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl font-mono">
                    {errorMsg}
                  </div>
                )}

                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label htmlFor="survey-name" className="text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Full Name</label>
                    <input 
                      id="survey-name"
                      type="text" 
                      required
                      placeholder="e.g. Peterson Allen"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full bg-slate-950 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#14B8A6] transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="survey-email" className="text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Email Address</label>
                    <input 
                      id="survey-email"
                      type="email" 
                      required
                      placeholder="name@domain.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#14B8A6] transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="survey-phone" className="text-xs font-mono uppercase tracking-wider text-[#94A3B8]">Phone Number (Optional)</label>
                    <input 
                      id="survey-phone"
                      type="tel" 
                      placeholder="+1 (555) 0100"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#14B8A6] transition-colors"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="survey-symptoms" className="text-xs font-mono uppercase tracking-wider text-[#94A3B8]">What's going on? (Optional)</label>
                    <textarea 
                      id="survey-symptoms"
                      rows={3}
                      placeholder="Pain, injury history, movement deficits..."
                      value={symptoms}
                      onChange={(e) => setSymptoms(e.target.value)}
                      className="w-full bg-slate-950 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-[#14B8A6] transition-colors resize-none"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <Button 
                    type="button" 
                    variant="ghost" 
                    onClick={() => setModalOpen(false)}
                    className="text-xs font-bold"
                  >
                    Cancel
                  </Button>
                  <Button 
                    type="submit" 
                    disabled={loading}
                    className="bg-[#14B8A6] hover:bg-[#14B8A6]/90 text-white font-bold px-6 text-xs h-9 flex items-center justify-center"
                  >
                    {loading ? "Sending..." : "Submit Survey"}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="text-center py-8 space-y-6">
                <div className="w-16 h-16 bg-[#14B8A6]/10 border border-[#14B8A6]/20 rounded-full flex items-center justify-center mx-auto text-[#14B8A6]">
                  <Sparkles className="w-8 h-8" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-bold text-white">Intake Submitted</h3>
                  <p className="text-sm text-[#94A3B8] max-w-sm mx-auto leading-relaxed">
                    Thank you. We will analyze your symptoms and connect you with a biomechanics specialist within one business day.
                  </p>
                </div>
                <Button 
                  onClick={() => setModalOpen(false)}
                  className="bg-[#14B8A6] hover:bg-[#14B8A6]/90 text-white font-bold px-6 text-xs h-9"
                >
                  Dismiss
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Mount React Root
const container = document.getElementById("root")
if (container) {
  const root = createRoot(container)
  root.render(<LandingPage />)
}
