'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function RegisterPage() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username, // se guarda en user_metadata
        },
      },
    })

    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }

    // Guardar el username también en una tabla 'perfiles' (opcional pero recomendado)
    if (data.user) {
      await supabase.from('perfiles').insert({
        id: data.user.id,
        username: username,
        email: email,
      })
    }

    setLoading(false)
    setSuccess(true)
  }

  if (success) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="register-success-title">
          <div className="auth-panel auth-panel-success">
            <h1 id="register-success-title">¡Revisa tu correo!</h1>
            <p>Te enviamos un enlace para confirmar tu cuenta antes de iniciar sesión.</p>
            <Link className="auth-button-link" href="/login">Volver al login</Link>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="register-title">
        <div className="auth-panel auth-panel-register">
          <h1 id="register-title">Crear cuenta</h1>

          <form className="auth-form" onSubmit={handleRegister}>
            <label htmlFor="username">Usuario</label>
            <input
              id="username"
              name="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
            />

            <label htmlFor="email">Correo</label>
            <input
              id="email"
              name="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
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
              {loading ? 'Creando cuenta...' : 'Registrarme'}
            </button>
          </form>

          <p className="auth-switch">
            ¿Ya tienes cuenta? <Link href="/login">Inicia sesión aquí</Link>
          </p>
        </div>
      </section>
    </main>
  )
}