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
      <div style={{ maxWidth: 320, margin: '80px auto' }}>
        <h1>¡Revisa tu correo!</h1>
        <p>Te enviamos un enlace para confirmar tu cuenta antes de iniciar sesión.</p>
        <Link href="/login">Volver al login</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 320, margin: '80px auto' }}>
      <h1>Crear cuenta</h1>

      <form onSubmit={handleRegister}>
        <label>
          Usuario
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
          />
        </label>

        <label>
          Correo
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error && <p style={{ color: 'red' }}>{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Creando cuenta...' : 'Registrarme'}
        </button>
      </form>

      <p>
        ¿Ya tienes cuenta? <Link href="/login">Inicia sesión aquí</Link>
      </p>
    </div>
  )
}