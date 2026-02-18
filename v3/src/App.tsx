import { Home } from './pages/Home.tsx';
import { Race } from './pages/Race.tsx';

function App() {
  // Simple client-side routing based on pathname
  const path = window.location.pathname;

  if (path === '/race') {
    return <Race />;
  }

  return <Home />;
}

export default App;
