import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  CircleSlash,
  Eye,
  Info,
  Lightbulb,
  Loader2,
  Play,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardTitleGroup,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { SelectNative } from '@/components/ui/select-native';
import { PageSkeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/page-header';
import { useToast } from '@/components/ui/toast';
import { useAuth } from '@/lib/auth-context';
import {
  fetchAIConfig,
  fetchAIInsights,
  saveAIConfig,
  updateAIInsight,
  updateBatch,
  runAIAdvisor,
} from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

export default function AIPage() {
  const { can } = useAuth();
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [insights, setInsights] = useState(null);
  const [runBusy, setRunBusy] = useState(false);
  const [reloadBusy, setReloadBusy] = useState(false);
  // When a run is in flight we poll aggressively (every 5s) for up to
  // 3 minutes so the new insight appears shortly after the model
  // finishes, without holding an open HTTP request for that long.
  const [activeRun, setActiveRun] = useState(null); // { startedAt, provider, model, baselineCount }

  async function load() {
    try {
      const [c, ins] = await Promise.all([
        can('admin') ? fetchAIConfig() : Promise.resolve(null),
        fetchAIInsights(50),
      ]);
      setConfig(c);
      setInsights(ins);
    } catch (err) {
      toast.error(err);
    }
  }

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  // Fast-poll while a run is in flight. Clears itself when a new
  // insight arrives (count > baseline) or after 3 minutes.
  useEffect(() => {
    if (!activeRun) return;
    const fast = setInterval(async () => {
      try {
        const ins = await fetchAIInsights(50);
        setInsights(ins);
        const newCount = ins.count_24h ?? 0;
        if (newCount > activeRun.baselineCount) {
          toast.success(
            `${newCount - activeRun.baselineCount} insight(s) generated via ${activeRun.provider}`
          );
          setActiveRun(null);
          return;
        }
        if (Date.now() - activeRun.startedAt > 3 * 60 * 1000) {
          // Ran long enough that we should stop burning polls. Likely
          // either a silent failure or a very slow local model. Either
          // way the 30s polling below will still pick it up.
          toast.warn('Run is taking longer than 3 minutes — still running in the background');
          setActiveRun(null);
        }
      } catch { /* keep trying */ }
    }, 5000);
    return () => clearInterval(fast);
  }, [activeRun, toast]);

  async function refresh() {
    setReloadBusy(true);
    try { await load(); } finally { setReloadBusy(false); }
  }

  async function generateNow() {
    setRunBusy(true);
    try {
      const result = await runAIAdvisor();
      if (result.already_running) {
        toast.warn('A run is already in progress — results will appear shortly');
      } else if (result.started) {
        const baselineCount = insights?.count_24h ?? 0;
        setActiveRun({
          startedAt: Date.now(),
          provider: result.provider,
          model: result.model,
          baselineCount,
        });
        toast.info(
          `Analyzing chamber via ${result.provider}${result.model ? ' · ' + result.model : ''} — insights will appear here shortly`
        );
      } else {
        toast.error(result.error || 'Run did not start');
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setRunBusy(false);
    }
  }

  async function setStatus(id, status) {
    try {
      await updateAIInsight(id, status);
      await load();
    } catch (err) {
      toast.error(err);
    }
  }

  if (!insights) return <PageSkeleton rows={3} />;

  return (
    <>
      <PageHeader
        title="AI advisor"
        description="Claude or Ollama reviews chamber state and proposes tuning. Never actuates directly."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={reloadBusy}>
              <RefreshCw className={cn(reloadBusy && 'animate-spin')} />
              Refresh
            </Button>
            {can('mutate') && (
              <Button
                size="sm"
                onClick={generateNow}
                disabled={runBusy || !!activeRun}
              >
                {runBusy || activeRun ? <Loader2 className="animate-spin" /> : <Sparkles />}
                {activeRun
                  ? `Running · ${activeRun.provider}`
                  : runBusy
                    ? 'Starting…'
                    : 'Generate now'}
              </Button>
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_400px]">
        <InsightsCard
          insights={insights}
          onStatus={setStatus}
          canMutate={can('mutate')}
        />
        {config && (
          <ConfigCard
            config={config}
            onSaved={(next) => setConfig(next)}
            readOnly={!can('admin')}
          />
        )}
      </div>
    </>
  );
}

// ---------- Insights feed ----------

const SEVERITY_META = {
  info: { variant: 'info', Icon: Info },
  warn: { variant: 'warning', Icon: AlertTriangle },
};

const CATEGORY_META = {
  observation: { label: 'Observation', variant: 'muted', Icon: Eye },
  recommendation: { label: 'Recommendation', variant: 'success', Icon: Lightbulb },
  warning: { label: 'Warning', variant: 'warning', Icon: AlertTriangle },
};

function InsightsCard({ insights, onStatus, canMutate }) {
  const entries = insights?.entries || [];
  const active = entries.filter((e) => e.status === 'new' || e.status === 'acknowledged');
  const archived = entries.filter((e) => e.status === 'dismissed' || e.status === 'applied');

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-muted-foreground" />
            <CardTitle>Insights</CardTitle>
          </div>
          <CardDescription>
            {insights?.count_24h ?? 0} in last 24h · {entries.length} total shown
          </CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="pt-0">
        {entries.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-background/30 py-10 text-center text-sm text-muted-foreground">
            <Sparkles className="mx-auto mb-2 size-6 text-muted-foreground/50" />
            No insights yet. Enable the advisor under Config, then click
            <span className="font-medium text-foreground"> Generate now</span>.
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {active.map((ins) => (
                <InsightRow key={ins.id} insight={ins} canMutate={canMutate} onStatus={onStatus} />
              ))}
            </ul>
            {archived.length > 0 && (
              <details className="mt-5">
                <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                  Archived ({archived.length})
                </summary>
                <ul className="mt-3 space-y-3 opacity-75">
                  {archived.map((ins) => (
                    <InsightRow key={ins.id} insight={ins} canMutate={canMutate} onStatus={onStatus} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function InsightRow({ insight, canMutate, onStatus }) {
  const sev = SEVERITY_META[insight.severity] || SEVERITY_META.info;
  const cat = CATEGORY_META[insight.category] || CATEGORY_META.observation;
  const CatIcon = cat.Icon;
  return (
    <li
      className={cn(
        'rounded-lg border p-3',
        insight.severity === 'warn' ? 'border-warning/40 bg-warning/5' : 'border-border bg-card'
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <div className={cn('grid size-7 shrink-0 place-items-center rounded-md', insight.severity === 'warn' ? 'bg-warning/15 text-warning' : 'bg-muted text-muted-foreground')}>
            <CatIcon className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={cat.variant} className="text-[10px] uppercase">{cat.label}</Badge>
              {insight.severity === 'warn' && (
                <Badge variant={sev.variant} className="text-[10px] uppercase"><sev.Icon className="size-3" />warn</Badge>
              )}
              {insight.status !== 'new' && (
                <Badge variant="muted" className="text-[10px] uppercase">{insight.status}</Badge>
              )}
            </div>
            <div className="mt-1 text-sm font-semibold leading-tight">{insight.title}</div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{insight.body}</p>
          </div>
        </div>
      </div>

      {insight.actions?.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {insight.actions.map((a, i) => (
            <InsightAction key={i} action={a} insight={insight} canMutate={canMutate} onStatus={onStatus} />
          ))}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>
          {insight.provider} · {insight.model || '—'} · {formatRelative(insight.timestamp)}
          {insight.input_tokens != null && ` · ${insight.input_tokens}→${insight.output_tokens} tok`}
        </span>
        {canMutate && insight.status !== 'dismissed' && insight.status !== 'applied' && (
          <div className="flex gap-1">
            {insight.status !== 'acknowledged' && (
              <Button variant="ghost" size="sm" onClick={() => onStatus(insight.id, 'acknowledged')}>
                <Check />Ack
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => onStatus(insight.id, 'applied')}>
              <CheckCircle2 />Applied
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onStatus(insight.id, 'dismissed')}
              className="text-muted-foreground hover:bg-danger/10 hover:text-danger">
              <Trash2 />Dismiss
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// Action tile. Structured kinds (like advance_batch_phase, added by
// the CV stage-watcher) render as clickable buttons that apply the
// change directly and mark the insight as 'applied'. Unstructured
// hints from the advisor keep their read-only label+hint form.
function InsightAction({ action, insight, canMutate, onStatus }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (action.kind === 'advance_batch_phase' && action.batch_id && action.phase) {
    async function apply() {
      if (!confirm(`Advance batch to ${action.phase}?`)) return;
      setBusy(true);
      try {
        await updateBatch(action.batch_id, { phase: action.phase });
        await onStatus(insight.id, 'applied');
        toast.success(`Advanced to ${action.phase}`);
      } catch (err) {
        toast.error(err);
      } finally {
        setBusy(false);
      }
    }
    return (
      <Button
        size="sm"
        variant="default"
        onClick={apply}
        disabled={!canMutate || busy || insight.status === 'applied'}
        title={action.hint}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Play />}
        {action.label}
      </Button>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/40 px-2 py-1 text-[11px]"
      title={action.hint}
    >
      <span className="font-medium">{action.label}</span>
      {action.hint && <span className="text-muted-foreground">· {action.hint}</span>}
    </span>
  );
}

// ---------- Config card (owner only) ----------

function ConfigCard({ config, onSaved, readOnly }) {
  const toast = useToast();
  const [form, setForm] = useState({
    enabled: config.enabled,
    provider: config.provider,
    anthropic_api_key: '',
    anthropic_model: config.anthropic.model,
    ollama_base_url: config.ollama.base_url,
    ollama_model: config.ollama.model,
    cadence_hours: String(config.cadence_hours),
  });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const patch = {
        enabled: form.enabled,
        provider: form.provider,
        anthropic_model: form.anthropic_model,
        ollama_base_url: form.ollama_base_url,
        ollama_model: form.ollama_model,
        cadence_hours: parseInt(form.cadence_hours, 10) || 6,
      };
      if (form.anthropic_api_key.trim()) {
        patch.anthropic_api_key = form.anthropic_api_key.trim();
      }
      const next = await saveAIConfig(patch);
      setForm({ ...form, anthropic_api_key: '' });
      onSaved(next);
      toast.success('AI config saved');
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  }

  if (readOnly) {
    return (
      <Card>
        <CardHeader>
          <CardTitleGroup>
            <div className="flex items-center gap-2">
              <Settings className="size-4 text-muted-foreground" />
              <CardTitle>Config</CardTitle>
            </div>
            <CardDescription>Owner-only</CardDescription>
          </CardTitleGroup>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Only the chamber owner can change the AI provider or credentials.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitleGroup>
          <div className="flex items-center gap-2">
            <Settings className="size-4 text-muted-foreground" />
            <CardTitle>Config</CardTitle>
          </div>
          <CardDescription>Provider · credentials · cadence</CardDescription>
        </CardTitleGroup>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-md border border-border bg-background/40 px-3 py-2">
          <div>
            <div className="text-sm font-medium">Enabled</div>
            <p className="text-[11px] text-muted-foreground">
              Scheduled reviews fire every {form.cadence_hours} h when on. Manual generation always works.
            </p>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
            aria-label="Toggle AI advisor"
          />
        </div>

        <div>
          <Label htmlFor="ai-provider">Provider</Label>
          <SelectNative
            id="ai-provider"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value })}
            className="mt-1.5"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="ollama">Ollama (self-hosted)</option>
          </SelectNative>
        </div>

        {form.provider === 'anthropic' ? (
          <>
            <div>
              <Label htmlFor="ai-key">Anthropic API key</Label>
              <Input
                id="ai-key"
                type="password"
                value={form.anthropic_api_key}
                placeholder={config.anthropic.has_key ? '•••••••• (set — type to replace)' : 'sk-ant-…'}
                onChange={(e) => setForm({ ...form, anthropic_api_key: e.target.value })}
                className="mt-1.5 font-mono"
                autoComplete="off"
              />
              <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                {config.anthropic.has_key ? (
                  <><CheckCircle2 className="size-3 text-success" /> Key on file (never shown).</>
                ) : (
                  <><CircleSlash className="size-3" /> No key set.</>
                )}
              </p>
            </div>
            <div>
              <Label htmlFor="ai-anthropic-model">Model</Label>
              <Input
                id="ai-anthropic-model"
                value={form.anthropic_model}
                onChange={(e) => setForm({ ...form, anthropic_model: e.target.value })}
                className="mt-1.5 font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Default: <code className="font-mono">{config.defaults.anthropic_model}</code>.
                Override to use Sonnet/Haiku for cost.
              </p>
            </div>
          </>
        ) : (
          <>
            <div>
              <Label htmlFor="ai-ollama-url">Ollama base URL</Label>
              <Input
                id="ai-ollama-url"
                value={form.ollama_base_url}
                onChange={(e) => setForm({ ...form, ollama_base_url: e.target.value })}
                className="mt-1.5 font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Default <code className="font-mono">{config.defaults.ollama_base_url}</code>.
                Point at any reachable Ollama instance (same Pi, LAN server, etc.).
              </p>
            </div>
            <div>
              <Label htmlFor="ai-ollama-model">Model</Label>
              <Input
                id="ai-ollama-model"
                value={form.ollama_model}
                onChange={(e) => setForm({ ...form, ollama_model: e.target.value })}
                className="mt-1.5 font-mono"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Must be pulled on the Ollama host first (<code className="font-mono">ollama pull llama3.2</code>).
                Small 3B–8B models work; the system prompt asks for JSON so very small models can drift.
              </p>
            </div>
          </>
        )}

        <div>
          <Label htmlFor="ai-cadence">Cadence (hours)</Label>
          <Input
            id="ai-cadence"
            type="number"
            min="1"
            max="168"
            value={form.cadence_hours}
            onChange={(e) => setForm({ ...form, cadence_hours: e.target.value })}
            className="mt-1.5"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            6 h is a good starting point. Lower = more timely + higher cost; higher = cheaper + may miss drift.
          </p>
        </div>

        <Button onClick={save} disabled={busy} className="w-full">
          <Play />
          {busy ? 'Saving…' : 'Save config'}
        </Button>
      </CardContent>
    </Card>
  );
}
