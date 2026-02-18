export function Home() {
  return (
    <div className="min-h-screen bg-dark-500 text-white flex flex-col">
      {/* Hero section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div className="text-center max-w-2xl">
          {/* Title */}
          <h1 className="text-6xl font-bold mb-4 bg-gradient-to-r from-player via-accent to-ai bg-clip-text text-transparent">
            Shadow Driver
          </h1>
          <p className="text-xl text-white/60 mb-2">v3 - Head to Head Racing</p>
          <p className="text-white/40 mb-12 max-w-md mx-auto">
            Race head-to-head against a real neural network running in CARLA simulator
            on a cloud GPU. Real model inference. Real physics. Every frame.
          </p>

          {/* Start button */}
          <a
            href="/race"
            className="inline-block py-4 px-12 bg-gradient-to-r from-player to-ai rounded-xl text-white font-bold text-xl hover:opacity-90 transition-opacity shadow-lg shadow-player/20 hover:shadow-ai/30 animate-glow"
          >
            Start Race
          </a>

          {/* Features grid */}
          <div className="grid grid-cols-3 gap-6 mt-16 text-left">
            <div className="bg-dark-300/50 rounded-lg p-4 border border-white/5">
              <div className="text-player text-2xl mb-2">&#9881;</div>
              <h3 className="text-white font-bold text-sm mb-1">Real AI</h3>
              <p className="text-white/40 text-xs">
                PilotNet neural network makes driving decisions on every frame.
                No scripted behavior.
              </p>
            </div>
            <div className="bg-dark-300/50 rounded-lg p-4 border border-white/5">
              <div className="text-ai text-2xl mb-2">&#127918;</div>
              <h3 className="text-white font-bold text-sm mb-1">CARLA Simulator</h3>
              <p className="text-white/40 text-xs">
                Photorealistic driving environment with real physics.
                Video streams directly to your browser.
              </p>
            </div>
            <div className="bg-dark-300/50 rounded-lg p-4 border border-white/5">
              <div className="text-accent text-2xl mb-2">&#9889;</div>
              <h3 className="text-white font-bold text-sm mb-1">Cloud GPU</h3>
              <p className="text-white/40 text-xs">
                Runs on Vast.ai cloud GPUs. No downloads, no installs.
                ~$0.50-1.50/hr.
              </p>
            </div>
          </div>

          {/* How it works */}
          <div className="mt-12 text-left max-w-lg mx-auto">
            <h3 className="text-white/50 text-xs font-mono uppercase tracking-wider mb-4">How it works</h3>
            <div className="space-y-3">
              <Step n={1} text="Click Start Race - we provision a GPU with CARLA simulator" />
              <Step n={2} text="CARLA starts with two cars: you (keyboard) and AI (neural network)" />
              <Step n={3} text="Video streams to your browser via Cloudflare tunnel" />
              <Step n={4} text="Race 3 laps - beat the AI to win!" />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="text-center py-6 text-white/20 text-xs font-mono">
        Shadow Driver v3 &middot; CARLA + PilotNet + Vast.ai
      </footer>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-accent/20 text-accent text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </div>
      <p className="text-white/50 text-sm">{text}</p>
    </div>
  );
}
