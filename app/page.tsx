'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function Home() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()

      const { data: email, error: rpcError } = await supabase.rpc(
        'get_email_by_username',
        { lookup_username: username.trim() }
      )

      if (rpcError || !email) {
        setError('Usuario o contraseña incorrectos')
        return
      }

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError('Usuario o contraseña incorrectos')
        return
      }

      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      console.error('Error inesperado al iniciar sesión:', err)
      setError('Ocurrió un error inesperado, revisa la consola del navegador')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="auth-panel auth-panel-login">
          <h1 id="login-title">Iniciar sesión</h1>

          <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />

            <label htmlFor="password">Contraseña</label>
            <input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />

            {error && <p className="auth-error" role="alert">{error}</p>}

            <button type="submit" disabled={loading}>
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <p className="auth-switch">
            ¿No tienes cuenta? <Link href="/register">Regístrate aquí</Link>
          </p>
        </div>
      </section>
    </main>
  )
}