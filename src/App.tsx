import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { routes } from './routes'

// GitHub Pages'da sayt /<repo>/ ichida ochiladi; BASE_URL build paytida Vite'dan keladi
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

const router = createBrowserRouter(routes, { basename })

export function App() {
  return <RouterProvider router={router} />
}
