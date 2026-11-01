import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/arena.css'
import './styles/log.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
