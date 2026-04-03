import { useEffect, useState } from 'react'
import { admin } from '../api/client'
import styles from './Incidents.module.css'

export default function Incidents() {
  const [incidents, setIncidents] = useState<any[]>([])
  const [pagination, setPagination] = useState({ total: 0, limit: 50, offset: 0 })
  const [status, setStatus] = useState<string>('')
  const [type, setType] = useState<string>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [actioning, setActioning] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const load = () => {
    setLoading(true)
    admin
      .incidents({
        status: status || undefined,
        type: type || undefined,
        limit: 50,
        offset: 0,
      })
      .then((res) => {
        setIncidents(res.incidents)
        setPagination(res.pagination || { total: res.incidents.length, limit: 50, offset: 0 })
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [status, type])

  const handleVerify = async (id: string) => {
    setActioning(id)
    try {
      await admin.verify(id)
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActioning(null)
    }
  }

  const exportCsv = () => {
    const headers = ['id', 'type', 'severity', 'category', 'lat', 'lng', 'timestamp', 'verified', 'user_id']
    const rows = incidents.map((i) => [
      i.id,
      i.type,
      String(i.severity ?? ''),
      String(i.category ?? ''),
      String(i.location?.lat ?? ''),
      String(i.location?.lng ?? ''),
      i.timestamp,
      i.verified ? 'true' : 'false',
      String(i.user_id ?? ''),
    ])
    const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`
    const csv = [headers.join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleReject = async (id: string, reason?: string) => {
    setActioning(id)
    try {
      await admin.reject(id, reason)
      setRejectReason('')
      load()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setActioning(null)
    }
  }

  return (
    <div>
      <h1>Moderation queue</h1>
      <p className={styles.muted}>Review and verify or reject community reports</p>

      <div className={styles.filters}>
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
          </select>
        </label>
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All</option>
            <option value="panic_alert">Panic alert</option>
            <option value="community_report">Community report</option>
          </select>
        </label>
        <button type="button" onClick={load} className={styles.refresh}>Refresh</button>
        <button type="button" onClick={exportCsv} className={styles.refresh} disabled={!incidents.length}>
          Export CSV
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {loading ? (
        <div className={styles.loading}>Loading…</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Category</th>
                <th>Location</th>
                <th>Time</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((i) => (
                <tr key={i.id}>
                  <td><code>{i.id.slice(0, 14)}…</code></td>
                  <td>{i.type}</td>
                  <td>{i.severity}</td>
                  <td>{i.category || '—'}</td>
                  <td>
                    <a
                      href={`https://www.google.com/maps?q=${i.location.lat},${i.location.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {i.location.lat.toFixed(4)}, {i.location.lng.toFixed(4)}
                    </a>
                  </td>
                  <td>{new Date(i.timestamp).toLocaleString()}</td>
                  <td>
                    <span className={i.verified ? styles.badgeOk : styles.badgePending}>
                      {i.verified ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    {!i.verified && (
                      <span className={styles.actions}>
                        <button
                          type="button"
                          className={styles.btnOk}
                          onClick={() => handleVerify(i.id)}
                          disabled={actioning === i.id}
                        >
                          Verify
                        </button>
                        <button
                          type="button"
                          className={styles.btnDanger}
                          onClick={() => handleReject(i.id, rejectReason || 'rejected')}
                          disabled={actioning === i.id}
                        >
                          Reject
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {incidents.length === 0 && (
            <p className={styles.empty}>No incidents match the filters</p>
          )}
        </div>
      )}

      <p className={styles.count}>
        Showing {incidents.length} of {pagination.total}
      </p>
    </div>
  )
}
