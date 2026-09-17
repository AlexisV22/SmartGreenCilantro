'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'

export default function DashboardPage() {
  const [email, setEmail] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/')
        return
      }

      setEmail(data.user.email ?? null)
    })
  }, [router])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <main style={{ maxWidth: 640, margin: '80px auto' }}>
      <h1>Dashboard</h1>
      <p>{email ? `Sesión iniciada como ${email}` : 'Cargando sesión...'}</p>
      <button type="button" onClick={handleSignOut}>
        Cerrar sesión
      </button>
    </main>
  )
}
