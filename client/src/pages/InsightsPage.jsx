// agent-7-insights: owner-facing analytics. Plain numbers and short named lists
// per DESIGN.md; the only chart is a single bar per weekday.
import { useEffect, useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Box, Typography, Paper, Button, Divider, Chip } from '@mui/material';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import { api } from '../api';
import PageHeader from '../components/PageHeader';
import LoadingScreen from '../components/LoadingScreen';
import { useSnackbar } from '../components/SnackbarProvider';
import { md3Colors, shape } from '../theme';

const cardSx = {
  mb: 3,
  borderRadius: `${shape.extraLarge}px`,
  bgcolor: md3Colors.surfaceBright,
  boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.04)',
  overflow: 'hidden',
};

function SectionCard({ title, caption, children }) {
  return (
    <Paper elevation={0} sx={cardSx}>
      <Box sx={{ p: 3 }}>
        <Typography variant="titleLarge" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        {caption && (
          <Typography
            variant="bodySmall"
            sx={{ color: md3Colors.onSurfaceVariant, display: 'block', mb: 2 }}
          >
            {caption}
          </Typography>
        )}
        {children}
      </Box>
    </Paper>
  );
}

function NotAvailable({ reason }) {
  return (
    <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
      Not available — {reason || 'this metric has no data source in this deployment'}.
    </Typography>
  );
}

function StatStrip({ stats }) {
  return (
    <Paper
      elevation={0}
      sx={{ mb: 3, borderRadius: `${shape.extraLarge}px`, bgcolor: md3Colors.primaryContainer, overflow: 'hidden' }}
    >
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: `repeat(${stats.length}, 1fr)` } }}>
        {stats.map((stat, i) => (
          <Box
            key={stat.label}
            sx={{
              px: 3,
              py: 2.5,
              borderRight: {
                xs: i % 2 === 0 ? '1px solid rgba(0, 25, 70, 0.12)' : 'none',
                sm: i < stats.length - 1 ? '1px solid rgba(0, 25, 70, 0.12)' : 'none',
              },
              borderBottom: {
                xs: i < stats.length - 2 ? '1px solid rgba(0, 25, 70, 0.12)' : 'none',
                sm: 'none',
              },
            }}
          >
            <Typography
              variant="bodySmall"
              sx={{ color: md3Colors.onPrimaryContainer, opacity: 0.72, display: 'block', mb: 0.5 }}
            >
              {stat.label}
            </Typography>
            <Typography
              variant="displaySmall"
              sx={{ color: md3Colors.onPrimaryContainer, fontWeight: 500, lineHeight: 1.1 }}
            >
              {stat.value}
            </Typography>
            {stat.hint && (
              <Typography
                variant="bodySmall"
                sx={{ color: md3Colors.onPrimaryContainer, opacity: 0.72, display: 'block', mt: 0.5 }}
              >
                {stat.hint}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Paper>
  );
}

function StudentRow({ primary, secondary, badge, badgeColor }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.25, minHeight: 44 }}>
      <Box>
        <Typography variant="titleSmall">{primary}</Typography>
        <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
          {secondary}
        </Typography>
      </Box>
      {badge && (
        <Chip
          label={badge}
          size="small"
          sx={{
            bgcolor: badgeColor === 'error' ? md3Colors.errorContainer : md3Colors.secondaryContainer,
            color: badgeColor === 'error' ? md3Colors.onErrorContainer : md3Colors.onSecondaryContainer,
            height: 24,
            fontSize: '11px',
            flexShrink: 0,
          }}
        />
      )}
    </Box>
  );
}

function AtRiskSection({ atRisk }) {
  const { showSnackbar } = useSnackbar();
  const [extra, setExtra] = useState([]);
  const [loadingMore, setLoadingMore] = useState(false);

  if (!atRisk.available) {
    return (
      <SectionCard title="At-risk students">
        <NotAvailable reason={atRisk.reason} />
      </SectionCard>
    );
  }

  const shown = [...atRisk.students, ...extra];
  const remaining = atRisk.total - shown.length;

  async function loadMore() {
    setLoadingMore(true);
    try {
      const page = Math.floor(shown.length / 25) + 1;
      const data = await api.getAtRiskStudents({ page, pageSize: 25 });
      const known = new Set(shown.map((s) => s.id));
      setExtra((prev) => [...prev, ...data.students.filter((s) => !known.has(s.id))]);
    } catch (err) {
      showSnackbar(err.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <SectionCard
      title="At-risk students"
      caption={`Visits in the last ${atRisk.window_days} days dropped more than ${atRisk.threshold_pct}% vs the ${atRisk.window_days} days before`}
    >
      {atRisk.total === 0 ? (
        <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
          No students show a visit drop past the threshold. Nothing to chase this week.
        </Typography>
      ) : (
        <>
          {shown.map((s, i) => (
            <Box key={s.id}>
              {i > 0 && <Divider sx={{ borderColor: md3Colors.outlineVariant }} />}
              <StudentRow
                primary={s.name}
                secondary={`${s.recent_visits} visits, down from ${s.prior_visits}`}
                badge={`−${s.drop_pct}%`}
                badgeColor="error"
              />
            </Box>
          ))}
          {remaining > 0 && (
            <Button variant="text" onClick={loadMore} disabled={loadingMore} sx={{ mt: 1 }}>
              {loadingMore ? 'Loading…' : `Show ${remaining} more`}
            </Button>
          )}
        </>
      )}
    </SectionCard>
  );
}

function RegularsSection({ regulars }) {
  if (!regulars.available) {
    return (
      <SectionCard title="Lapsed regulars">
        <NotAvailable reason={regulars.reason} />
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Lapsed regulars"
      caption="Had 3+ visits the week before last, fewer than 3 in the last 7 days"
    >
      {regulars.lapsed_count === 0 ? (
        <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
          Every recent regular is still coming 3+ times a week.
        </Typography>
      ) : (
        regulars.lapsed_students.map((s, i) => (
          <Box key={s.id}>
            {i > 0 && <Divider sx={{ borderColor: md3Colors.outlineVariant }} />}
            <StudentRow
              primary={s.name}
              secondary={`${s.visits_this_week} visits this week, ${s.visits_prior_week} the week before`}
            />
          </Box>
        ))
      )}
    </SectionCard>
  );
}

function UtilizationSection({ utilization, headroom }) {
  const chartData = (utilization?.weekdays || []).map((d) => ({
    weekday: d.weekday,
    'Avg check-ins': d.avg_checkins,
    Capacity: d.capacity ?? 0,
  }));
  const headroomRows = headroom?.available
    ? headroom.weekdays.filter((d) => d.capacity != null)
    : [];

  return (
    <SectionCard
      title="Weekday utilization and headroom"
      caption={
        utilization
          ? `Average check-ins per weekday, past ${utilization.window_days} days`
          : 'Utilization report unavailable'
      }
    >
      {utilization && (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={md3Colors.outlineVariant} />
            <XAxis dataKey="weekday" tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: md3Colors.onSurfaceVariant }} />
            <Tooltip />
            <Bar dataKey="Avg check-ins" fill={md3Colors.primary} radius={[4, 4, 0, 0]} />
            <Bar dataKey="Capacity" fill={md3Colors.outlineVariant} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
      <Box sx={{ mt: 2 }}>
        {headroom?.available ? (
          headroomRows.map((d) => (
            <Typography key={d.weekday} variant="bodyMedium" sx={{ display: 'block', py: 0.5 }}>
              {d.headroom > 0
                ? `Room for ${d.headroom} more student${d.headroom === 1 ? '' : 's'} on ${d.weekday} (capacity ${d.capacity}, averaging ${d.avg_checkins})`
                : `${d.weekday} runs at capacity (${d.capacity}, averaging ${d.avg_checkins})`}
            </Typography>
          ))
        ) : (
          <Typography variant="bodyMedium" sx={{ color: md3Colors.onSurfaceVariant }}>
            Headroom needs a weekday capacity — set one in Admin → Staff &amp; center.
          </Typography>
        )}
      </Box>
    </SectionCard>
  );
}

function StaffEfficiencySection({ efficiency }) {
  if (!efficiency.available) {
    return (
      <SectionCard title="Staffing cost per visit">
        <NotAvailable reason={efficiency.reason} />
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Staffing cost per visit"
      caption="Rough operational indicator: total payroll divided by total visits. It does not attribute which staff member served which student."
    >
      <Typography variant="bodyLarge" sx={{ display: 'block', mb: 0.5 }}>
        {efficiency.cost_per_visit != null
          ? `$${efficiency.cost_per_visit.toFixed(2)} per visit`
          : 'No completed shifts and visits in this window yet'}
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
        ${efficiency.total_payroll_cost.toFixed(2)} payroll · {efficiency.total_staff_hours} staff
        hours · {efficiency.total_visits} visits · {efficiency.start_date} to {efficiency.end_date}
        {efficiency.staff_missing_rate > 0 &&
          ` · ${efficiency.staff_missing_rate} staff member${efficiency.staff_missing_rate === 1 ? '' : 's'} worked shifts without an hourly rate set`}
      </Typography>
    </SectionCard>
  );
}

function BookingConversionSection({ conversion }) {
  if (!conversion.available) {
    return (
      <SectionCard title="Booking-to-visit conversion">
        <NotAvailable reason={conversion.reason} />
      </SectionCard>
    );
  }
  return (
    <SectionCard
      title="Booking-to-visit conversion"
      caption="Confirmed bookings on past days that produced a same-day check-in. Future bookings are excluded until their day passes."
    >
      <Typography variant="bodyLarge" sx={{ display: 'block', mb: 0.5 }}>
        {conversion.conversion_pct != null
          ? `${conversion.conversion_pct}% converted`
          : 'No confirmed bookings on past days in this window'}
      </Typography>
      <Typography variant="bodySmall" sx={{ color: md3Colors.onSurfaceVariant }}>
        {conversion.converted_bookings} of {conversion.confirmed_bookings} confirmed bookings ·{' '}
        {conversion.start_date} to {conversion.end_date}
      </Typography>
    </SectionCard>
  );
}

export default function InsightsPage() {
  const [summary, setSummary] = useState(null);
  const [utilization, setUtilization] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([
      api.getInsightsSummary(),
      api.getUtilization().catch(() => null),
    ])
      .then(([summaryData, utilizationData]) => {
        setSummary(summaryData);
        setUtilization(utilizationData);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingScreen message="Loading insights..." />;

  if (error) {
    return (
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: 2, py: 4, textAlign: 'center' }}>
        <InsightsOutlinedIcon sx={{ fontSize: 64, color: md3Colors.outlineVariant, mb: 2 }} />
        <Typography variant="bodyMedium" sx={{ color: md3Colors.error }}>
          {error}
        </Typography>
      </Box>
    );
  }

  const stats = [
    {
      label: 'Regulars',
      value: summary.regulars.available ? summary.regulars.regular_count : '—',
      hint: '3+ visits this week',
    },
    {
      label: 'Lapsing',
      value: summary.regulars.available ? summary.regulars.lapsed_count : '—',
      hint: 'Were regulars, now not',
    },
    {
      label: 'At risk',
      value: summary.at_risk.available ? summary.at_risk.total : '—',
      hint: `Visits down >${summary.at_risk.available ? summary.at_risk.threshold_pct : 50}%`,
    },
    {
      label: 'Cost per visit',
      value:
        summary.staff_efficiency.available && summary.staff_efficiency.cost_per_visit != null
          ? `$${summary.staff_efficiency.cost_per_visit.toFixed(2)}`
          : '—',
      hint: 'Payroll ÷ visits (rough)',
    },
  ];

  return (
    <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 3 }, py: { xs: 3, md: 4 }, pb: { xs: 12, md: 4 } }}>
      <PageHeader
        title="Insights"
        subtitle={`Owner analytics · trailing ${summary.window_days} days · ${summary.timezone}`}
      />

      <StatStrip stats={stats} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 3 }}>
        <AtRiskSection atRisk={summary.at_risk} />
        <RegularsSection regulars={summary.regulars} />
      </Box>

      <UtilizationSection utilization={utilization} headroom={summary.capacity_headroom} />

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, columnGap: 3 }}>
        <StaffEfficiencySection efficiency={summary.staff_efficiency} />
        <BookingConversionSection conversion={summary.booking_conversion} />
      </Box>
    </Box>
  );
}
