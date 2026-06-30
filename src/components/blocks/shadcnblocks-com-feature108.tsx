import * as React from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import { Activity, BrainCircuit, ScanEye } from "lucide-react"

// Explain in comments why this architecture matters:
// - reusable design system: Components are built as standalone reusable Lego blocks.
// - scalable UI architecture: Adding new pages/routes doesn't cause style bloat or regression.
// - clean separation: UI components are isolated from page business logic.
// - future maintainability: Consistent class utilities and layout structures.
// - consistency across platform: The visual identity remains unified across landing and application states.

export default function Feature108() {
  return (
    <section className="py-20 md:py-28 relative overflow-hidden" id="features">
      {/* Background ambient radial glows */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#14B8A6]/5 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute top-10 right-10 w-[300px] h-[300px] bg-[#67E8F9]/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <Badge className="mb-4" variant="default">Intelligence Lane</Badge>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-white mb-6">
            Engineered for <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#14B8A6] via-[#67E8F9] to-[#D4AF37]">Human Optimization</span>
          </h2>
          <p className="text-lg text-[#94A3B8] leading-relaxed">
            NeuCore integrates clinical-grade biomechanical telemetry with neuro-performance analytics, bridging the gap between rehabilitation and elite power.
          </p>
        </div>

        <Tabs defaultValue="gait" className="w-full">
          <div className="flex justify-center mb-12">
            <TabsList className="grid grid-cols-3 w-full max-w-2xl bg-slate-950/80 border border-white/5 p-1.5 h-auto rounded-xl">
              <TabsTrigger value="gait" className="py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm">
                <ScanEye className="w-4 h-4" />
                <span className="hidden sm:inline">AI Gait Analysis</span>
              </TabsTrigger>
              <TabsTrigger value="neural" className="py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm">
                <BrainCircuit className="w-4 h-4" />
                <span className="hidden sm:inline">Neural Tracking</span>
              </TabsTrigger>
              <TabsTrigger value="biomech" className="py-3 px-4 rounded-lg flex items-center justify-center gap-2 text-sm">
                <Activity className="w-4 h-4" />
                <span className="hidden sm:inline">Biomechanics</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* TAB 1: AI GAIT ANALYSIS */}
          <TabsContent value="gait" className="focus:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center bg-slate-950/40 border border-white/5 p-8 md:p-12 rounded-3xl backdrop-blur-xl">
              <div className="lg:col-span-6 space-y-6">
                <Badge variant="gold">Phase I Real-time Telemetry</Badge>
                <h3 className="text-3xl font-bold text-white tracking-tight">
                  Optical AI Gait & Posture Diagnostics
                </h3>
                <p className="text-[#94A3B8] leading-relaxed text-base">
                  Analyze human motion markers instantly with markerless computer vision. NeuCore maps joint angles, pelvic tilts, and cadence asymmetries, generating live metrics with 0.1° degree angular precision.
                </p>
                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#14B8A6] mb-1">Precision</h4>
                    <p className="text-2xl font-bold text-white">99.8% Accuracy</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-1">Latency</h4>
                    <p className="text-2xl font-bold text-white">&lt; 12ms Processing</p>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-6 relative aspect-video rounded-2xl overflow-hidden border border-white/8 group">
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent z-10 opacity-60" />
                <img
                  src="https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?q=80&w=800"
                  alt="Futuristic AI Gait Analysis"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur border border-white/10 px-3 py-1.5 rounded-lg">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14B8A6] animate-ping" />
                  <span className="text-xs font-mono text-[#F8FAFC]">LIVE TELEMETRY STREAM</span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: NEURAL RECOVERY TRACKING */}
          <TabsContent value="neural" className="focus:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center bg-slate-950/40 border border-white/5 p-8 md:p-12 rounded-3xl backdrop-blur-xl">
              <div className="lg:col-span-6 space-y-6">
                <Badge variant="gold">Autonomic Recovery Analysis</Badge>
                <h3 className="text-3xl font-bold text-white tracking-tight">
                  Central Nervous System Feedback Loop
                </h3>
                <p className="text-[#94A3B8] leading-relaxed text-base">
                  Track autonomic reactivity, nervous system fatigue, and neural processing speeds. Our neuro-performance indexes assess systemic readiness scores so coaches can modulate loads with clinical safety.
                </p>
                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#14B8A6] mb-1">Index Core</h4>
                    <p className="text-2xl font-bold text-white">Nerve Reactivity</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-1">CNS Scope</h4>
                    <p className="text-2xl font-bold text-white">Fatigue Mapping</p>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-6 relative aspect-video rounded-2xl overflow-hidden border border-white/8 group">
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent z-10 opacity-60" />
                <img
                  src="https://images.unsplash.com/photo-1507668077129-56e32842fceb?q=80&w=800"
                  alt="Neural Recovery Assessment"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur border border-white/10 px-3 py-1.5 rounded-lg">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14B8A6] animate-ping" />
                  <span className="text-xs font-mono text-[#F8FAFC]">CNS SYNAPSE FEEDBACK</span>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 3: BIOMECHANICS INTELLIGENCE */}
          <TabsContent value="biomech" className="focus:outline-none">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center bg-slate-950/40 border border-white/5 p-8 md:p-12 rounded-3xl backdrop-blur-xl">
              <div className="lg:col-span-6 space-y-6">
                <Badge variant="gold">Clinical Biomechanics</Badge>
                <h3 className="text-3xl font-bold text-white tracking-tight">
                  Dynamic Muscle & Joint Load Vectors
                </h3>
                <p className="text-[#94A3B8] leading-relaxed text-base">
                  NeuCore tracks torque patterns and rotational loads during dynamic lifts. Understand joint stress profiles instantly, identifying functional compensation before pain or injury manifests.
                </p>
                <div className="grid grid-cols-2 gap-6 pt-4 border-t border-white/5">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#14B8A6] mb-1">Sensors</h4>
                    <p className="text-2xl font-bold text-white">Full-Body Synergy</p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-[#D4AF37] mb-1">Feedback</h4>
                    <p className="text-2xl font-bold text-white">Predictive AI Insights</p>
                  </div>
                </div>
              </div>
              <div className="lg:col-span-6 relative aspect-video rounded-2xl overflow-hidden border border-white/8 group">
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent z-10 opacity-60" />
                <img
                  src="https://images.unsplash.com/photo-1517838277536-f5f99be501cd?q=80&w=800"
                  alt="Sports Science and Biomechanics"
                  className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
                <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 bg-slate-900/90 backdrop-blur border border-white/10 px-3 py-1.5 rounded-lg">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#14B8A6] animate-ping" />
                  <span className="text-xs font-mono text-[#F8FAFC]">JOINT VECTOR CHARTING</span>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  )
}
