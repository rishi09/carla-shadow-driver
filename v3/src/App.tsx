import { Landing } from './pages/Landing.tsx';
import { Race } from './pages/Race.tsx';

function App() {
  // Simple client-side routing based on pathname
  const path = window.location.pathname;

  if (path === '/race') {
    return <Race />;
  }

  return <Landing />;
}

export default App;
