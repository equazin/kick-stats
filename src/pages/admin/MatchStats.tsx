import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, AlertTriangle, Copy, ExternalLink, Goal, Lock, Megaphone, Save, Sparkles, Star, Vote, Info, Trash2, RotateCcw, UserX } from "lucide-react";
import { fmtPartidoLargo } from "@/lib/dates";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import {
  useApplyMatchElo,
  useCloseMatchVoting,
  useMatch,
  useMatchContributionAmount,
  useMatchPlayers,
  useSaveMatchPlayers,
  useUpdateMatch,
  buildVotingWindowPatch,
  type MatchPlayerInput,
} from "@/hooks/useMatches";
import { usePlayers, type Player } from "@/hooks/usePlayers";
import { useDeleteVote, useDeleteVoterVotes, useResetMatchVoting, useVotes, tallyVotes, type Vote as VoteRow } from "@/hooks/useVotes";
import { FONDO, CALIFICACION_CRITERIOS, formatARS } from "@/lib/scoring";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Row {
  player_id: string;
  equipo: "A" | "B";
  goles: number;
  asistencias: number;
  calificacion: number | null;
  presente: boolean;
}

interface VoteAuditRow {
  voter: Player | null;
  voterId: string;
  mvpVote?: VoteRow;
  goalVote?: VoteRow;
  outsideRoster?: boolean;
}

type VoteConfirmAction =
  | { kind: "vote"; voteId: string; label: string }
  | { kind: "voter"; voterId: string; label: string }
  | { kind: "reset" };

const toDateTimeLocalValue = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

const getAnnouncementUrl = (matchId: string) => {
  if (typeof window === "undefined") return `#/anuncio/${matchId}`;
  return `${window.location.origin}${window.location.pathname}#/anuncio/${matchId}`;
};

const MatchStats = () => {
  const { id } = useParams<{ id: string }>();
  const { data: match, isLoading: loadingM } = useMatch(id);
  const { data: players = [] } = usePlayers();
  const { data: existingMP = [], isLoading: loadingMP } = useMatchPlayers(id);
  const { data: existingAporte } = useMatchContributionAmount(id);
  const { data: votes = [] } = useVotes(id);

  const saveMut = useSaveMatchPlayers();
  const updateMut = useUpdateMatch();
  const closeMut = useCloseMatchVoting();
  const applyEloMut = useApplyMatchElo();
  const deleteVoteMut = useDeleteVote();
  const deleteVoterVotesMut = useDeleteVoterVotes();
  const resetVotingMut = useResetMatchVoting();

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [fecha, setFecha] = useState("");
  const [estado, setEstado] = useState<string>("pendiente");
  const [mvpId, setMvpId] = useState<string>("none");
  const [golFechaId, setGolFechaId] = useState<string>("none");
  const [aportePorJugador, setAportePorJugador] = useState<number>(FONDO.APORTE_POR_PARTIDO);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmEloRetry, setConfirmEloRetry] = useState(false);
  const [voteConfirmAction, setVoteConfirmAction] = useState<VoteConfirmAction | null>(null);

  useEffect(() => {
    if (!existingMP.length) return;
    const next: Record<string, Row> = {};
    existingMP.forEach((mp: any) => {
      next[mp.player_id] = {
        player_id: mp.player_id,
        equipo: mp.equipo,
        goles: Number(mp.goles ?? 0),
        asistencias: Number(mp.asistencias ?? 0),
        calificacion: mp.calificacion === null ? null : Number(mp.calificacion),
        presente: mp.presente !== false,
      };
    });
    setRows(next);
  }, [existingMP]);

  useEffect(() => {
    if (!match) return;
    setScoreA(Number(match.equipo_a_score ?? 0));
    setScoreB(Number(match.equipo_b_score ?? 0));
    setFecha(toDateTimeLocalValue(match.fecha));
    setEstado(match.estado);
    setMvpId(match.mvp_player_id ?? "none");
    setGolFechaId(match.gol_de_la_fecha_player_id ?? "none");
  }, [match]);

  useEffect(() => {
    if (typeof existingAporte === "number" && existingAporte > 0) {
      setAportePorJugador(existingAporte);
      return;
    }
    setAportePorJugador(FONDO.APORTE_POR_PARTIDO);
  }, [existingAporte]);

  const teamA = useMemo(() => Object.values(rows).filter((r) => r.presente && r.equipo === "A"), [rows]);
  const teamB = useMemo(() => Object.values(rows).filter((r) => r.presente && r.equipo === "B"), [rows]);
  const presentes = useMemo(() => Object.values(rows).filter((r) => r.presente), [rows]);

  const mvpTally = useMemo(() => tallyVotes(votes, "mvp"), [votes]);
  const goalTally = useMemo(() => tallyVotes(votes, "goal"), [votes]);
  const totalVoters = useMemo(() => new Set(votes.map((v) => v.voter_player_id)).size, [votes]);
  const isFriendly = Boolean((match as any)?.is_friendly);
  const eloApplied = Boolean((match as any)?.elo_applied);
  const announcementMvpId = match?.mvp_player_id ?? mvpTally[0]?.player_id;
  const announcementGoalId = match?.gol_de_la_fecha_player_id ?? goalTally[0]?.player_id;
  const announcementUrl = id ? getAnnouncementUrl(id) : "";

  const closeBlockers = useMemo(() => {
    const issues: string[] = [];
    if (teamA.length === 0 || teamB.length === 0)
      issues.push("Ambos equipos deben tener al menos un jugador presente.");
    if (scoreA === 0 && scoreB === 0 && presentes.length > 0)
      issues.push("El resultado es 0-0. Guardá el marcador antes de cerrar.");
    if (mvpId === "none" && mvpTally.length === 0)
      issues.push("No hay MVP asignado ni votos de MVP.");
    return issues;
  }, [teamA, teamB, scoreA, scoreB, presentes, mvpId, mvpTally]);

  const playerById = (playerId: string) => players.find((p) => p.id === playerId);

  const voteAudit = useMemo(() => {
    const votesByVoter = new Map<string, { mvpVote?: VoteRow; goalVote?: VoteRow }>();
    votes.forEach((vote) => {
      const entry = votesByVoter.get(vote.voter_player_id) ?? {};
      if (vote.type === "mvp") entry.mvpVote = vote;
      if (vote.type === "goal") entry.goalVote = vote;
      votesByVoter.set(vote.voter_player_id, entry);
    });

    const officialVoterIds = new Set<string>();
    const officialRows = presentes
      .map((row) => {
        const voter = players.find((player) => player.id === row.player_id) ?? null;
        if (!voter || (voter.tipo ?? "titular") === "invitado") return null;
        officialVoterIds.add(row.player_id);
        const entry = votesByVoter.get(row.player_id) ?? {};
        return {
          voter,
          voterId: row.player_id,
          mvpVote: entry.mvpVote,
          goalVote: entry.goalVote,
        };
      })
      .filter((row): row is VoteAuditRow => row !== null);

    const outsideRows = Array.from(votesByVoter.entries())
      .filter(([voterId]) => !officialVoterIds.has(voterId))
      .map(([voterId, entry]) => ({
        voter: players.find((player) => player.id === voterId) ?? null,
        voterId,
        mvpVote: entry.mvpVote,
        goalVote: entry.goalVote,
        outsideRoster: true,
      }));

    const rows = [...officialRows, ...outsideRows].sort((a, b) => {
      const aName = a.voter?.apodo ?? a.voter?.nombre ?? a.voterId;
      const bName = b.voter?.apodo ?? b.voter?.nombre ?? b.voterId;
      return aName.localeCompare(bName);
    });

    return {
      rows,
      completeCount: officialRows.filter((row) => row.mvpVote && row.goalVote).length,
      officialCount: officialRows.length,
      outsideCount: outsideRows.length,
    };
  }, [players, presentes, votes]);

  const voteTargetName = (vote?: VoteRow) => {
    if (!vote) return "Sin voto";
    const player = playerById(vote.voted_player_id);
    return player?.apodo ?? player?.nombre ?? "Jugador eliminado";
  };

  const voteCreatedAt = (vote?: VoteRow) =>
    vote ? new Date(vote.created_at).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "-";

  const copyToClipboard = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error("No se pudo copiar al portapapeles.");
    }
  };

  const copyAnnouncementLink = () => {
    if (!announcementUrl) return;
    void copyToClipboard(announcementUrl, "Link del anuncio copiado");
  };

  const copyAnnouncementText = () => {
    if (!announcementUrl || !match) return;
    const mvp = announcementMvpId ? playerById(announcementMvpId) : null;
    const goal = announcementGoalId ? playerById(announcementGoalId) : null;
    const status = estado === "cerrado" ? "Ganadores oficiales" : "Ganadores provisorios";
    const lines = [
      `${status} - Futbol y Porro FC`,
      fmtPartidoLargo(match.fecha),
      `Resultado: Equipo A ${match.equipo_a_score} - ${match.equipo_b_score} Equipo B`,
      `MVP: ${mvp?.apodo ?? mvp?.nombre ?? "-"}`,
      `Gol de la fecha: ${goal?.apodo ?? goal?.nombre ?? "-"}`,
      announcementUrl,
    ];
    void copyToClipboard(lines.join("\n"), "Texto del anuncio copiado");
  };

  const updateRow = (playerId: string, patch: Partial<Row>) =>
    setRows((prev) => ({ ...prev, [playerId]: { ...prev[playerId], ...patch } }));

  const eloSkipMessage = (reason?: string) => {
    if (reason === "already_applied") return "El ELO ya estaba aplicado.";
    if (reason === "pending") return "Primero marca el partido como jugado.";
    if (reason === "missing_teams") return "Faltan jugadores presentes en ambos equipos.";
    return "No se pudo aplicar el ELO.";
  };

  const onApplyElo = async (force = false) => {
    if (!id) return;
    try {
      const result = await applyEloMut.mutateAsync({ matchId: id, force });
      if (result.applied) {
        toast.success(`ELO actualizado (${result.eloUpdates.length} jugadores)`);
      } else {
        toast.info(eloSkipMessage(result.skippedReason));
      }
      setConfirmEloRetry(false);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "No se pudo aplicar el ELO."));
    }
  };

  const onSaveStats = async () => {
    if (!id) return;
    const payload: MatchPlayerInput[] = presentes.map((r) => ({
      player_id: r.player_id,
      equipo: r.equipo,
      goles: r.goles,
      asistencias: r.asistencias,
      calificacion: r.calificacion,
      presente: true,
    }));
    const derivedScoreA = payload
      .filter((r) => r.equipo === "A")
      .reduce((sum, r) => sum + Number(r.goles || 0), 0);
    const derivedScoreB = payload
      .filter((r) => r.equipo === "B")
      .reduce((sum, r) => sum + Number(r.goles || 0), 0);
    const nextScoreA = scoreA || derivedScoreA;
    const nextScoreB = scoreB || derivedScoreB;
    const hasScoreForElo = nextScoreA !== 0 || nextScoreB !== 0;

    try {
      await saveMut.mutateAsync({
        matchId: id,
        players: payload,
        aportePorJugador,
      });
      // Transición automática pendiente → jugado al cargar stats
      if ((estado === "pendiente" || (!eloApplied && hasScoreForElo)) && payload.length > 0) {
        const fechaIso = fecha ? new Date(fecha).toISOString() : match?.fecha;
        const nextEstado = estado === "pendiente" ? "jugado" : estado;
        const scorePatch = hasScoreForElo
          ? { equipo_a_score: nextScoreA, equipo_b_score: nextScoreB }
          : {};
        await updateMut.mutateAsync({
          id,
          estado: nextEstado as any,
          ...scorePatch,
          ...buildVotingWindowPatch(fechaIso!, nextEstado),
        } as any);
        setEstado(nextEstado);
        setScoreA(nextScoreA);
        setScoreB(nextScoreB);
        if (hasScoreForElo) toast.success("ELO actualizado");
        toast.success("Stats guardadas · Partido marcado como jugado");
      } else {
        toast.success("Stats guardadas");
      }
    } catch (e: any) {
      toast.error(e.message ?? "No se pudieron guardar las stats.");
    }
  };

  const onSaveResult = async () => {
    if (!id) return;
    if (!fecha) {
      toast.error("La fecha y hora del partido es obligatoria.");
      return;
    }
    try {
      const fechaIso = new Date(fecha).toISOString();
      await updateMut.mutateAsync({
        id,
        fecha: fechaIso,
        equipo_a_score: scoreA,
        equipo_b_score: scoreB,
        estado: estado as any,
        mvp_player_id: isFriendly || mvpId === "none" ? null : mvpId,
        gol_de_la_fecha_player_id: isFriendly || golFechaId === "none" ? null : golFechaId,
        ...buildVotingWindowPatch(fechaIso, estado),
      } as any);
      toast.success(estado === "pendiente" ? "Partido guardado" : "Partido guardado · ELO actualizado");
    } catch (e: any) {
      if (e?.code === "23505" && e?.message?.includes("matches_fecha_key")) {
        toast.error("Ya existe un partido con esa fecha y hora.");
        return;
      }
      toast.error(e.message ?? "No se pudo guardar el partido.");
    }
  };

  const onSaveDate = async () => {
    if (!id) return;
    if (!fecha) {
      toast.error("La fecha y hora del partido es obligatoria.");
      return;
    }
    try {
      const fechaIso = new Date(fecha).toISOString();
      await updateMut.mutateAsync({
        id,
        fecha: fechaIso,
        ...buildVotingWindowPatch(fechaIso, estado),
      } as any);
      toast.success("Fecha actualizada");
    } catch (e: any) {
      if (e?.code === "23505" && e?.message?.includes("matches_fecha_key")) {
        toast.error("Ya existe un partido con esa fecha y hora.");
        return;
      }
      toast.error(e.message ?? "No se pudo guardar la fecha.");
    }
  };

  const onCloseVoting = async () => {
    if (!id) return;
    try {
      const result = await closeMut.mutateAsync(id);
      const mvp = players.find((p) => p.id === result.mvp);
      const gol = players.find((p) => p.id === result.gol);
      toast.success(`Votacion cerrada · MVP: ${mvp?.apodo ?? mvp?.nombre ?? "-"} · Gol: ${gol?.apodo ?? gol?.nombre ?? "-"}`);
      setConfirmClose(false);
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo cerrar la votacion.");
    }
  };

  const onConfirmVoteAction = async () => {
    if (!id || !voteConfirmAction) return;
    try {
      if (voteConfirmAction.kind === "vote") {
        await deleteVoteMut.mutateAsync({ matchId: id, voteId: voteConfirmAction.voteId });
        toast.success("Voto anulado");
      }
      if (voteConfirmAction.kind === "voter") {
        await deleteVoterVotesMut.mutateAsync({ matchId: id, voterId: voteConfirmAction.voterId });
        toast.success("Votos del jugador anulados");
      }
      if (voteConfirmAction.kind === "reset") {
        await resetVotingMut.mutateAsync(id);
        setEstado("jugado");
        setMvpId("none");
        setGolFechaId("none");
        toast.success("Votacion reiniciada por 48 hs");
      }
      setVoteConfirmAction(null);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "No se pudo actualizar la votacion."));
    }
  };

  if (loadingM || loadingMP || !match) {
    return <p className="text-muted-foreground">Cargando partido...</p>;
  }

  const headerFecha = fecha ? new Date(fecha).toISOString() : match.fecha;
  const voteActionPending = deleteVoteMut.isPending || deleteVoterVotesMut.isPending || resetVotingMut.isPending;

  const TeamCard = ({
    teamKey,
    title,
    playersRows,
    accentClass,
  }: {
    teamKey: "A" | "B";
    title: string;
    playersRows: Row[];
    accentClass: string;
  }) => (
    <div className="rounded-2xl border border-border/60 bg-card/20 overflow-hidden">
      <div className={`px-4 py-3 border-b border-border/50 ${accentClass}`}>
        <p className="font-black">{title}</p>
        <p className="text-xs text-muted-foreground">{playersRows.length} jugadores</p>
      </div>
      <div className="divide-y divide-border/40">
        {playersRows.map((row) => {
          const p = playerById(row.player_id);
          if (!p) return null;
          return (
            <div key={`${teamKey}-${row.player_id}`} className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="sm" />
                <p className="text-sm font-bold truncate">{p.apodo ?? p.nombre}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Goles</Label>
                  <Input
                    type="number"
                    min={0}
                    value={row.goles}
                    onChange={(e) => updateRow(row.player_id, { goles: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground">Asist.</Label>
                  <Input
                    type="number"
                    min={0}
                    value={row.asistencias}
                    onChange={(e) => updateRow(row.player_id, { asistencias: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-9"
                  />
                </div>
                <div>
                  <Label className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                    Calif.
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[220px] text-xs space-y-1">
                        {CALIFICACION_CRITERIOS.map((c) => (
                          <p key={c.rango}><span className="font-bold">{c.rango}</span> — {c.label}</p>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    step={0.5}
                    value={row.calificacion ?? ""}
                    placeholder="-"
                    onChange={(e) => {
                      const v = e.target.value;
                      updateRow(row.player_id, { calificacion: v === "" ? null : Math.min(10, Math.max(1, Number(v))) });
                    }}
                    className="h-9"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-border/60 bg-gradient-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary font-bold">Carga de stats</p>
            <h1 className="text-xl md:text-2xl font-black capitalize">
              {fmtPartidoLargo(headerFecha)}
            </h1>
            <p className="text-sm text-muted-foreground">
              Equipos definidos: {teamA.length} vs {teamB.length} · Carga rapida de goles, asistencias y calificacion.
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded border ${
                isFriendly ? "border-stats/40 bg-stats/10 text-stats" : "border-primary/40 bg-primary/10 text-primary"
              }`}>
                {isFriendly ? "Amistoso · solo ELO" : "Oficial · ranking + ELO"}
              </span>
              {eloApplied && (
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded border border-mvp/40 bg-mvp/10 text-mvp">
                  ELO aplicado
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            {!eloApplied && estado !== "pendiente" && (
              <Button type="button" variant="outline" onClick={() => onApplyElo()} disabled={applyEloMut.isPending}>
                <Sparkles className="h-4 w-4 mr-1.5" />
                {applyEloMut.isPending ? "Aplicando..." : "Aplicar ELO"}
              </Button>
            )}
            {eloApplied && estado !== "pendiente" && (
              <Button type="button" variant="outline" onClick={() => setConfirmEloRetry(true)} disabled={applyEloMut.isPending}>
                <Sparkles className="h-4 w-4 mr-1.5" />
                {applyEloMut.isPending ? "Aplicando..." : "Reintentar ELO"}
              </Button>
            )}
            <Button asChild variant="ghost">
              <Link to="/admin/partidos">
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Volver
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <div className="grid lg:grid-cols-2 gap-3">
        <TeamCard teamKey="A" title="Equipo A" playersRows={teamA} accentClass="bg-primary/10 text-primary" />
        <TeamCard teamKey="B" title="Equipo B" playersRows={teamB} accentClass="bg-stats/10 text-stats" />
      </div>

      <section className="rounded-2xl border border-mvp/30 bg-gradient-card p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] md:items-end">
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-[0.2em] text-mvp font-bold">Fondo comun</p>
            <h2 className="font-black">Aporte / extra del domingo</h2>
            <p className="text-xs text-muted-foreground">
              Este monto se guarda por cada jugador presente y despues alimenta la caja del fondo.
            </p>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <div className="space-y-2">
              <Label>Aporte por jugador</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={aportePorJugador}
                onChange={(e) => setAportePorJugador(Math.max(0, Number(e.target.value) || 0))}
                className="h-12 text-lg font-black"
              />
            </div>
            <div className="rounded-lg border border-mvp/30 bg-mvp/10 px-3 py-2 min-w-[132px]">
              <p className="text-[10px] uppercase font-bold text-mvp">Total fecha</p>
              <p className="font-black">{formatARS(presentes.length * aportePorJugador)}</p>
            </div>
          </div>
        </div>
      </section>

      <Button onClick={onSaveStats} disabled={saveMut.isPending} className="w-full shadow-glow" size="lg">
        <Save className="h-4 w-4 mr-2" />
        {saveMut.isPending ? "Guardando..." : "Guardar stats"}
      </Button>

      <section className="rounded-2xl border border-border/60 bg-gradient-card p-4 space-y-4">
        <h2 className="font-black">Resultado y premios</h2>
        <div className="grid md:grid-cols-3 gap-3">
          <div className="space-y-2 md:col-span-3">
            <Label>Fecha y hora</Label>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                type="datetime-local"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                className="h-12 font-bold"
              />
              <Button type="button" variant="outline" onClick={onSaveDate} disabled={updateMut.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Guardar fecha
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-primary font-bold">Equipo A</Label>
            <Input type="number" min={0} value={scoreA} onChange={(e) => setScoreA(Math.max(0, Number(e.target.value) || 0))} className="h-12 text-2xl font-black text-center" />
          </div>
          <div className="space-y-2">
            <Label className="text-stats font-bold">Equipo B</Label>
            <Input type="number" min={0} value={scoreB} onChange={(e) => setScoreB(Math.max(0, Number(e.target.value) || 0))} className="h-12 text-2xl font-black text-center" />
          </div>
        </div>

        <div className="grid md:grid-cols-3 gap-3">
          <div className="space-y-2">
            <Label>Estado</Label>
            <Select value={estado} onValueChange={setEstado}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="jugado">Jugado</SelectItem>
                <SelectItem value="cerrado">Cerrado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {!isFriendly && (
            <>
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Star className="h-3.5 w-3.5 text-mvp" />
                  MVP
                </Label>
                <Select value={mvpId} onValueChange={setMvpId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin MVP" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin MVP</SelectItem>
                    {/* Si hay plantel cargado, mostrar solo los presentes; si no, todos los jugadores */}
                    {(presentes.length > 0 ? presentes.map((r) => playerById(r.player_id)).filter(Boolean) : players).map((p) => (
                      <SelectItem key={p!.id} value={p!.id}>
                        {p!.apodo ?? p!.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1">
                  <Goal className="h-3.5 w-3.5 text-stats" />
                  Gol de la fecha
                </Label>
                <Select value={golFechaId} onValueChange={setGolFechaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin gol destacado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin gol destacado</SelectItem>
                    {/* Si hay plantel con goles, filtrar por goles; si no, todos los jugadores */}
                    {presentes.some((r) => r.goles > 0)
                      ? presentes.filter((r) => r.goles > 0).map((r) => {
                          const p = playerById(r.player_id);
                          if (!p) return null;
                          return (
                            <SelectItem key={r.player_id} value={r.player_id}>
                              {p.apodo ?? p.nombre} ({r.goles} gol)
                            </SelectItem>
                          );
                        })
                      : players.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.apodo ?? p.nombre}
                          </SelectItem>
                        ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>

        <Button onClick={onSaveResult} disabled={updateMut.isPending} className="w-full">
          <Sparkles className="h-4 w-4 mr-2" />
          {updateMut.isPending ? "Guardando..." : "Guardar partido"}
        </Button>
      </section>

      {!isFriendly && (
      <section className="rounded-2xl border border-mvp/30 bg-gradient-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-black flex items-center gap-2">
            <Vote className="h-4 w-4 text-mvp" />
            Votacion
          </h2>
          <span className="text-xs text-muted-foreground font-semibold">
            {totalVoters} {totalVoters === 1 ? "voto" : "votos"}
          </span>
        </div>

        {votes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aun no hay votos. Comparte <Link to="/votacion" className="text-mvp underline">/votacion</Link> con el grupo.
          </p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1">
                <Star className="h-3 w-3 text-mvp" />
                MVP
              </p>
              {mvpTally.slice(0, 5).map((t) => {
                const p = playerById(t.player_id);
                if (!p) return null;
                return (
                  <div key={`mvp-${t.player_id}`} className="flex items-center gap-2 text-sm">
                    <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="sm" />
                    <span className="font-semibold flex-1 truncate">{p.apodo ?? p.nombre}</span>
                    <span className="font-black text-mvp">{t.count}</span>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold flex items-center gap-1">
                <Goal className="h-3 w-3 text-stats" />
                Gol de la fecha
              </p>
              {goalTally.slice(0, 5).map((t) => {
                const p = playerById(t.player_id);
                if (!p) return null;
                return (
                  <div key={`goal-${t.player_id}`} className="flex items-center gap-2 text-sm">
                    <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="sm" />
                    <span className="font-semibold flex-1 truncate">{p.apodo ?? p.nombre}</span>
                    <span className="font-black text-stats">{t.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="font-black flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-primary" />
              Anuncio de ganadores
            </p>
            <p className="text-xs text-muted-foreground">
              Copia un link publico para mostrar MVP y Gol de la fecha. Si todavia no cerraste la votacion, el anuncio usa el conteo actual.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button asChild type="button" variant="outline" size="sm" disabled={!id}>
              <Link to={`/anuncio/${id}`}>
                <ExternalLink className="h-4 w-4 mr-1.5" />
                Abrir
              </Link>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={copyAnnouncementLink} disabled={!announcementUrl}>
              <Copy className="h-4 w-4 mr-1.5" />
              Copiar link
            </Button>
            <Button type="button" size="sm" onClick={copyAnnouncementText} disabled={!announcementUrl || (!announcementMvpId && !announcementGoalId)}>
              <Megaphone className="h-4 w-4 mr-1.5" />
              Copiar texto
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-border/60 bg-card/30 overflow-hidden">
          <div className="px-3 py-3 border-b border-border/40 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-black flex items-center gap-2">
                <UserX className="h-4 w-4 text-primary" />
                Auditoria de votos
              </p>
              <p className="text-xs text-muted-foreground">
                {voteAudit.completeCount}/{voteAudit.officialCount} jugadores oficiales con MVP y Gol registrados
                {voteAudit.outsideCount > 0 ? ` · ${voteAudit.outsideCount} votante fuera del plantel` : ""}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setVoteConfirmAction({ kind: "reset" })}
              disabled={resetVotingMut.isPending || estado === "pendiente"}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Reiniciar votacion
            </Button>
          </div>

          {voteAudit.rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Todavia no hay jugadores o votos para auditar.</p>
          ) : (
            <div className="divide-y divide-border/30">
              {voteAudit.rows.map((row) => {
                const voterName = row.voter?.apodo ?? row.voter?.nombre ?? "Jugador eliminado";
                const hasVotes = Boolean(row.mvpVote || row.goalVote);
                return (
                  <div key={row.voterId} className="p-3 grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(0,1.4fr)_auto] lg:items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      <PlayerAvatar nombre={row.voter?.nombre ?? "?"} foto_url={row.voter?.foto_url} size="sm" />
                      <div className="min-w-0">
                        <p className="font-bold text-sm truncate">{voterName}</p>
                        <p className={`text-[10px] uppercase tracking-wider font-bold ${row.outsideRoster ? "text-yellow-600" : hasVotes ? "text-primary" : "text-muted-foreground"}`}>
                          {row.outsideRoster ? "Fuera del plantel" : hasVotes ? row.mvpVote && row.goalVote ? "Completo" : "Incompleto" : "No voto"}
                        </p>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-2">
                      <div className="rounded-lg border border-mvp/25 bg-mvp/10 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-mvp font-black">MVP</p>
                            <p className="text-sm font-bold truncate">{voteTargetName(row.mvpVote)}</p>
                            <p className="text-[10px] text-muted-foreground">{voteCreatedAt(row.mvpVote)}</p>
                          </div>
                          {row.mvpVote && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setVoteConfirmAction({ kind: "vote", voteId: row.mvpVote!.id, label: `MVP de ${voterName}` })}
                              disabled={deleteVoteMut.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>

                      <div className="rounded-lg border border-stats/25 bg-stats/10 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider text-stats font-black">Gol</p>
                            <p className="text-sm font-bold truncate">{voteTargetName(row.goalVote)}</p>
                            <p className="text-[10px] text-muted-foreground">{voteCreatedAt(row.goalVote)}</p>
                          </div>
                          {row.goalVote && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => setVoteConfirmAction({ kind: "vote", voteId: row.goalVote!.id, label: `Gol de ${voterName}` })}
                              disabled={deleteVoteMut.isPending}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setVoteConfirmAction({ kind: "voter", voterId: row.voterId, label: voterName })}
                      disabled={!hasVotes || deleteVoterVotesMut.isPending}
                      className="lg:justify-self-end border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:text-muted-foreground"
                    >
                      <Trash2 className="h-4 w-4 mr-1.5" />
                      Anular votos
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {closeBlockers.length > 0 && estado !== "cerrado" && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 space-y-1">
            <p className="text-xs font-bold text-yellow-600 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Para cerrar el partido primero:
            </p>
            {closeBlockers.map((b) => (
              <p key={b} className="text-xs text-yellow-600 pl-5">· {b}</p>
            ))}
          </div>
        )}
        <Button
          onClick={() => setConfirmClose(true)}
          disabled={estado === "cerrado" || closeMut.isPending || closeBlockers.length > 0}
          variant="outline"
          className="w-full border-mvp/40 hover:bg-mvp/10 disabled:opacity-50"
        >
          <Lock className="h-4 w-4 mr-2" />
          {estado === "cerrado" ? "Partido cerrado" : "Cerrar votación y aplicar ganadores"}
        </Button>
      </section>
      )}

      {!isFriendly && (
      <AlertDialog open={confirmClose} onOpenChange={setConfirmClose}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cerrar votacion?</AlertDialogTitle>
            <AlertDialogDescription>
              Se asignaran MVP y Gol de la fecha segun los votos actuales y el partido pasara a estado <b>cerrado</b>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={onCloseVoting} className="bg-mvp text-mvp-foreground hover:bg-mvp/90">
              Cerrar votacion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      )}

      <AlertDialog open={confirmEloRetry} onOpenChange={setConfirmEloRetry}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reintentar ELO?</AlertDialogTitle>
            <AlertDialogDescription>
              Este partido ya figura como ELO aplicado. Usalo solo si los jugadores no cambiaron su ELO; si ya se habia aplicado bien, se sumara otra vez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => onApplyElo(true)} className="bg-primary text-primary-foreground hover:bg-primary/90">
              Reintentar ELO
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={voteConfirmAction !== null} onOpenChange={(open) => !open && setVoteConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {voteConfirmAction?.kind === "reset"
                ? "Reiniciar votacion?"
                : voteConfirmAction?.kind === "voter"
                  ? "Anular votos del jugador?"
                  : "Anular voto?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {voteConfirmAction?.kind === "reset"
                ? "Se borraran todos los votos del partido, se limpiaran MVP y Gol de la fecha, y la votacion quedara abierta por 48 horas desde ahora."
                : voteConfirmAction?.kind === "voter"
                  ? `Se borraran los votos MVP y Gol registrados por ${voteConfirmAction.label}.`
                  : `Se borrara el voto ${voteConfirmAction?.label ?? ""}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voteActionPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmVoteAction}
              disabled={voteActionPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {voteActionPending ? "Procesando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MatchStats;

