import { useEffect, useState } from 'react'
import { admin } from '../api/client'
import styles from './Audit.module.css'

export default function Audit() {
  const [list, setList] = useState<any[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    admin
      .audit()
      .then((res) => setList(res.audit || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className={styles.loading}>Loading audit log…</div>
  if (error) return <div className={styles.error}>Error: {error}</div>

  return (
    <div>
      <h1>Audit log</h1>
      <p className={styles.muted}>Moderation and verification history</p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Entity ID</th>
              <th>Action</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {list.map((entry: any, idx: number) => (
              <tr key={idx}>
                <td>{entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}</td>
                <td><code>{entry.actorId ? `${String(entry.actorId).slice(0, 12)}…` : '—'}</code></td>
                <td><code>{entry.entityId?.slice(0, 16)}…</code></td>
                <td>
                  <span
                    className={
                      String(entry.action || '').includes('reject')
                        ? styles.badgeReject
                        : styles.badgeOk
                    }
                  >
                    {entry.action}
                  </span>
                </td>
                <td>{entry.reason || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.length === 0 && (
          <p className={styles.empty}>No audit entries yet</p>
        )}
      </div>
    </div>
  )
}
