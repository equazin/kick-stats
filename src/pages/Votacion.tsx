import { useEffect, useMemo, useState } from "react";
import { Vote, Star, Goal, Check, ArrowLeft, Sparkles, Users } from "lucide-react";
import { fmtPartidoSinHora, fmtHora } from "@/lib/dates";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PlayerAvatar } from "@/components/players/PlayerAvatar";
import { getVotingDeadline, isVotingOpenForMatch, useMatches, useMatchPlayers } from "@/hooks/useMatches";
import { useVotes, useHasVoted, useCastVotes } from "@/hooks/useVotes";

type Step = "match" | "identify" | "vote" | "done";

const Votacion = () => {
  const { data: matches = [] } = useMatches();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const votables = useMemo(
    () => matches.filter((m) => isVotingOpenForMatch(m, now)),
    [matches, now],
  );

  const [step, setStep] = useState<Step>("match");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [voterId, setVoterId] = useState<string | null>(null);
  const [mvpVote, setMvpVote] = useState<string | null>(null);
  const [goalVote, setGoalVote] = useState<string | null>(null);

  const { data: mp = [] } = useMatchPlayers(matchId ?? undefined);
  const { data: votes = [] } = useVotes(matchId ?? undefined);
  const { data: voted } = useHasVoted(matchId ?? undefined, voterId ?? undefined);
  const castMut = useCastVotes();
  const selectedMatch = matches.find((m) => m.id === matchId);

  const winnerTeam = useMemo<"A" | "B" | null>(() => {
    if (!selectedMatch || selectedMatch.estado !== "jugado") return null;
    const scoreA = Number(selectedMatch.equipo_a_score ?? 0);
    const scoreB = Number(selectedMatch.equipo_b_score ?? 0);
    if (scoreA > scoreB) return "A";
    if (scoreB > scoreA) return "B";
    return null;
  }, [selectedMatch]);

  const officialPresentRows = useMemo(
    () => mp.filter((r: any) => r.presente && r.player?.tipo !== "invitado"),
    [mp],
  );
  const votablesPresentes = useMemo(
    () => officialPresentRows.map((r: any) => r.player),
    [officialPresentRows],
  );
  const votablePlayerIds = useMemo(
    () => new Set(votablesPresentes.map((p: any) => p.id)),
    [votablesPresentes],
  );
  const mvpCandidates = useMemo(
    () => officialPresentRows.filter((r: any) => r.equipo === winnerTeam).map((r: any) => r.player),
    [officialPresentRows, winnerTeam],
  );
  const mvpCandidateIds = useMemo(
    () => new Set(mvpCandidates.map((p: any) => p.id)),
    [mvpCandidates],
  );

  useEffect(() => {
    if (voted?.mvp && voted?.goal) setStep("done");
  }, [voted]);

  const reset = () => {
    setStep("match");
    setMatchId(null);
    setVoterId(null);
    setMvpVote(null);
    setGoalVote(null);
  };

  const onSubmit = async () => {
    if (!matchId || !voterId || !mvpVote || !goalVote) return;
    if (!winnerTeam) {
      toast.error("Para votar MVP primero tiene que estar cargado el resultado con equipo ganador.");
      return;
    }
    if (!votablePlayerIds.has(voterId) || !mvpCandidateIds.has(mvpVote) || !votablePlayerIds.has(goalVote)) {
      toast.error("Los jugadores invitados no participan en la votacion de MVP ni Gol de la fecha.");
      return;
    }
    try {
      await castMut.mutateAsync({ matchId, voterId, mvpVotedId: mvpVote, goalVotedId: goalVote });
      toast.success("Votos registrados");
      setStep("done");
    } catch (e: any) {
      toast.error(e.message ?? "No se pudo registrar la votacion");
    }
  };

  const votersList = useMemo(() => {
    const voteTypesByVoter = new Map<string, Set<string>>();
    votes.forEach((vote) => {
      const entry = voteTypesByVoter.get(vote.voter_player_id) ?? new Set<string>();
      entry.add(vote.type);
      voteTypesByVoter.set(vote.voter_player_id, entry);
    });

    return votablesPresentes
      .filter((player: any) => {
        const types = voteTypesByVoter.get(player.id);
        return types?.has("mvp") && types?.has("goal");
      })
      .sort((a: any, b: any) => (a.apodo ?? a.nombre).localeCompare(b.apodo ?? b.nombre));
  }, [votablesPresentes, votes]);

  const totalVoters = votersList.length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black flex items-center gap-2">
          <Vote className="h-6 w-6 text-mvp" />
          Votacion
        </h1>
        <p className="text-sm text-muted-foreground">MVP y Gol de la fecha</p>
      </header>

      {step === "match" && (
        <>
          {votables.length === 0 ? (
            <EmptyState
              icon={Vote}
              title="No hay partidos para votar"
              description="La votacion abre cuando el partido se marca como jugado y dura 48 horas."
            />
          ) : (
            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
                Elegi el partido
              </p>
              {votables.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setMatchId(m.id);
                    setStep("identify");
                  }}
                  className="w-full text-left rounded-2xl border border-border/60 bg-gradient-card p-4 transition-smooth hover:border-mvp/40 hover:shadow-glow"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-black capitalize">
                        {fmtPartidoSinHora(m.fecha)}
                      </p>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mt-1">
                        {m.estado} · {fmtHora(m.fecha)} hs
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Vota hasta {fmtPartidoSinHora(new Date(getVotingDeadline(m)).toISOString())} · {fmtHora(new Date(getVotingDeadline(m)).toISOString())} hs
                      </p>
                    </div>
                    {m.estado === "jugado" && (
                      <div className="text-right">
                        <p className="font-black text-xl">
                          {m.equipo_a_score} - {m.equipo_b_score}
                        </p>
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {step === "identify" && selectedMatch && (
        <div className="space-y-4">
          <Button variant="ghost" size="sm" onClick={() => setStep("match")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Cambiar partido
          </Button>
          <div className="rounded-xl border border-border/60 bg-gradient-card p-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">
              Partido seleccionado
            </p>
            <p className="font-black capitalize">
              {fmtPartidoSinHora(selectedMatch.fecha)}
            </p>
          </div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">
            Quien sos?
          </p>
          {votablesPresentes.length === 0 ? (
            <EmptyState
              icon={Vote}
              title="No hay jugadores habilitados para votar"
              description="Los invitados no participan en la votacion de MVP ni Gol de la fecha."
            />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {votablesPresentes.map((p: any) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setVoterId(p.id);
                    setStep("vote");
                  }}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border/40 bg-card/50 hover:border-mvp/40 hover:bg-card transition-smooth"
                >
                  <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="lg" />
                  <p className="font-bold text-sm text-center truncate w-full">
                    {p.apodo ?? p.nombre}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {step === "vote" && voterId && (
        <div className="space-y-5">
          <Button variant="ghost" size="sm" onClick={() => setStep("identify")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> No soy yo
          </Button>

          {voted?.mvp && voted?.goal ? (
            <div className="rounded-xl border border-mvp/30 bg-mvp/10 p-4 text-center">
              <Check className="h-8 w-8 text-mvp mx-auto mb-2" />
              <p className="font-black">Ya votaste en este partido</p>
              <Button variant="link" onClick={() => setStep("done")} className="mt-2">
                Ver quienes votaron
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-mvp/30 bg-gradient-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Star className="h-5 w-5 text-mvp" />
                  <h3 className="font-black">MVP del partido</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Solo entre jugadores oficiales del equipo ganador.
                </p>
                {!winnerTeam ? (
                  <p className="text-sm text-muted-foreground text-center py-3">
                    Carga el resultado con equipo ganador para habilitar MVP.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {mvpCandidates
                      .filter((p: any) => p.id !== voterId)
                      .map((p: any) => (
                        <button
                          key={p.id}
                          onClick={() => setMvpVote(p.id)}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-smooth ${
                            mvpVote === p.id
                              ? "border-mvp bg-mvp/15 shadow-glow"
                              : "border-border/40 bg-card/50 hover:border-mvp/40"
                          }`}
                        >
                          <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="md" />
                          <p className="font-bold text-xs text-center truncate w-full">
                            {p.apodo ?? p.nombre}
                          </p>
                          {mvpVote === p.id && <Check className="h-3 w-3 text-mvp" />}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-stats/30 bg-gradient-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Goal className="h-5 w-5 text-stats" />
                  <h3 className="font-black">Gol de la fecha</h3>
                </div>
                <p className="text-xs text-muted-foreground mb-3">
                  Cualquier jugador oficial presente puede ser votado.
                </p>
                {votablesPresentes.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">
                    No hay jugadores oficiales presentes.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {votablesPresentes.map((p: any) => (
                      <button
                        key={p.id}
                        onClick={() => setGoalVote(p.id)}
                        className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-smooth ${
                          goalVote === p.id
                            ? "border-stats bg-stats/15 shadow-glow"
                            : "border-border/40 bg-card/50 hover:border-stats/40"
                        }`}
                      >
                        <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="md" />
                        <p className="font-bold text-xs text-center truncate w-full">
                          {p.apodo ?? p.nombre}
                        </p>
                        {goalVote === p.id && <Check className="h-3 w-3 text-stats" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Button
                onClick={onSubmit}
                disabled={!mvpVote || !goalVote || castMut.isPending}
                className="w-full shadow-glow"
                size="lg"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Confirmar votos
              </Button>
            </>
          )}
        </div>
      )}

      {step === "done" && selectedMatch && (
        <div className="space-y-4">
          <div className="rounded-xl border border-mvp/30 bg-mvp/10 p-4 text-center">
            <Check className="h-8 w-8 text-mvp mx-auto mb-2" />
            <p className="font-black">Gracias por votar</p>
            <p className="text-xs text-muted-foreground mt-1">
              {totalVoters} {totalVoters === 1 ? "jugador voto" : "jugadores votaron"} hasta ahora
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-gradient-card p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="h-4 w-4 text-mvp" />
              <h3 className="font-black">Ya votaron</h3>
            </div>
            {votersList.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-2">Todavia no figura ningun voto.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {votersList.map((p: any) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/50 p-2">
                    <PlayerAvatar nombre={p.nombre} foto_url={p.foto_url} size="sm" />
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{p.apodo ?? p.nombre}</p>
                      <p className="text-[10px] uppercase tracking-wider text-primary font-bold">Voto registrado</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Los resultados quedan ocultos hasta que el admin cierre la votacion.
          </p>
          <Button variant="outline" onClick={reset} className="w-full">
            Votar en otro partido
          </Button>
        </div>
      )}
    </div>
  );
};

export default Votacion;
