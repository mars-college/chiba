import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import App from './App'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './styles.css'

const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily:
    'Alegreya Sans, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  headings: {
    fontFamily: 'Oxanium, Alegreya Sans, ui-sans-serif, system-ui',
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
)
