import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { FONDO } from "@/lib/scoring";
import { avgElo, expectedScore, newElo, teamResult, ELO_INICIAL } from "@/lib/elo";
import { isVotingExpiredForMatch } from "@/lib/voting";
export {
  buildVotingWindowPatch,
  getVotingDeadline,
  isVotingOpenForMatch,
  isVotingExpiredForMatch,
  VOTING_WINDOW_MS,
} from "@/lib/voting";

export type Match = Database["public"]["Tables"]["matches"]["Row"];
export type MatchInsert = Database["public"]["Tables"]["matches"]["Insert"];
export type MatchPlayer = Database["public"]["Tables"]["match_players"]["Row"];

export const useMatches = () =>
  useQuery({
    queryKey: ["matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*, mvp:players!matches_mvp_player_id_fkey(id, nombre, apodo, foto_url), gol_fecha:players!matches_gol_de_la_fecha_player_id_fkey(id, nombre, apodo, foto_url)")
        .order("fecha", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

export const useMatch = (id?: string) =>
  useQuery({
    queryKey: ["match", id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*, mvp:players!matches_mvp_player_id_fkey(id, nombre, apodo, foto_url), gol_fecha:players!matches_gol_de_la_fecha_player_id_fkey(id, nombre, apodo, foto_url)")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data;
    },
  });

export const useMatchPlayers = (matchId?: string) =>
  useQuery({
    queryKey: ["match_players", matchId],
    enabled: !!matchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("match_players")
        .select("*, player:players(id, nombre, apodo, foto_url, posicion, tipo)")
        .eq("match_id", matchId!);
      if (error) throw error;
      return data;
    },
  });

export const useMatchContributionAmount = (matchId?: string) =>
  useQuery({
    queryKey: ["match_contribution_amount", matchId],
    enabled: !!matchId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contributions")
        .select("monto")
        .eq("match_id", matchId!);
      if (error) throw error;
      if (!data || data.length === 0) return null;
      const avg = data.reduce((acc, r) => acc + Number(r.monto || 0), 0) / data.length;
      return Math.round(avg);
    },
  });

export const useCreateMatch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: MatchInsert) => {
      const { data, error } = await supabase.from("matches").insert(input).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["matches"] }),
  });
};

export const useDeleteMatch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("matches").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["fondo"] });
    },
  });
};

export interface MatchPlayerInput {
  player_id: string;
  equipo: "A" | "B";
  goles?: number;
  asistencias?: number;
  calificacion?: number | null;
  presente?: boolean;
}

const uniqueMatchPlayers = (players: MatchPlayerInput[]) => {
  const byPlayerId = new Map<string, MatchPlayerInput>();
  players.forEach((player) => {
    if (!byPlayerId.has(player.player_id)) {
      byPlayerId.set(player.player_id, player);
    }
  });
  return Array.from(byPlayerId.values());
};

export interface EloUpdateResult {
  applied: boolean;
  skippedReason?: string;
  eloUpdates: { id: string; elo: number }[];
}

export const applyMatchEloIfNeeded = async (
  matchId: string,
  options: { force?: boolean } = {},
): Promise<EloUpdateResult> => {
  const [matchRes, mpRes] = await Promise.all([
    (supabase as any)
      .from("matches")
      .select("*")
      .eq("id", matchId)
      .single(),
    supabase
      .from("match_players")
      .select("player_id, equipo, presente, player:players(id, elo, tipo)")
      .eq("match_id", matchId),
  ]);

  if (matchRes.error) throw matchRes.error;
  if (mpRes.error) throw mpRes.error;

  const match = matchRes.data as any;
  if (!match || match.estado === "pendiente") {
    return { applied: false, skippedReason: "pending", eloUpdates: [] };
  }
  if (match.elo_applied === true && !options.force) {
    return { applied: false, skippedReason: "already_applied", eloUpdates: [] };
  }

  const rows = ((mpRes.data ?? []) as any[]).filter((r) => r.presente && r.player?.tipo !== "invitado");
  const teamA = rows.filter((r) => r.equipo === "A");
  const teamB = rows.filter((r) => r.equipo === "B");
  if (teamA.length === 0 || teamB.length === 0) {
    return { applied: false, skippedReason: "missing_teams", eloUpdates: [] };
  }

  const scoreA = Number(match.equipo_a_score ?? 0);
  const scoreB = Number(match.equipo_b_score ?? 0);
  const eloA = avgElo(teamA.map((r) => Number(r.player?.elo ?? ELO_INICIAL)));
  const eloB = avgElo(teamB.map((r) => Number(r.player?.elo ?? ELO_INICIAL)));
  const resultA = teamResult(scoreA, scoreB);
  const resultB = 1 - resultA;
  const expA = expectedScore(eloA, eloB);
  const expB = 1 - expA;

  const eloUpdates: { id: string; elo: number }[] = [
    ...teamA.map((r) => ({
      id: r.player_id as string,
      elo: Math.round(newElo(Number(r.player?.elo ?? ELO_INICIAL), expA, resultA)),
    })),
    ...teamB.map((r) => ({
      id: r.player_id as string,
      elo: Math.round(newElo(Number(r.player?.elo ?? ELO_INICIAL), expB, resultB)),
    })),
  ];

  const updateResults = await Promise.all(
    eloUpdates.map((u) => supabase.from("players").update({ elo: u.elo } as any).eq("id", u.id))
  );
  const updateError = updateResults.find((res) => res.error)?.error;
  if (updateError) throw updateError;

  const { error: markErr } = await (supabase as any)
    .from("matches")
    .update({ elo_applied: true, elo_applied_at: new Date().toISOString() })
    .eq("id", matchId);
  if (markErr) throw markErr;

  return { applied: true, eloUpdates };
};

export const useApplyMatchElo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ matchId, force = false }: { matchId: string; force?: boolean }) =>
      applyMatchEloIfNeeded(matchId, { force }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["match", vars.matchId] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["chemistry"] });
    },
  });
};

export const useSaveMatchPlayers = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      matchId,
      players,
      aportePorJugador,
    }: {
      matchId: string;
      players: MatchPlayerInput[];
      aportePorJugador?: number;
    }) => {
      const aporte = Math.max(0, Number(aportePorJugador ?? FONDO.APORTE_POR_PARTIDO));
      const uniquePlayers = uniqueMatchPlayers(players);

      const { error: delErr } = await supabase.from("match_players").delete().eq("match_id", matchId);
      if (delErr) throw delErr;

      const { data: existingContribs, error: existingContribsErr } = await supabase
        .from("contributions")
        .select("player_id, pagado")
        .eq("match_id", matchId);
      if (existingContribsErr) throw existingContribsErr;
      const paidByPlayer = new Map(
        (existingContribs ?? []).map((row) => [row.player_id, Boolean(row.pagado)])
      );

      const { error: delContribsErr } = await supabase.from("contributions").delete().eq("match_id", matchId);
      if (delContribsErr) throw delContribsErr;

      if (uniquePlayers.length > 0) {
        const rows = uniquePlayers.map((p) => ({ match_id: matchId, ...p }));
        const { error: insErr } = await supabase.from("match_players").insert(rows);
        if (insErr) throw insErr;

        const ids = uniquePlayers.map((p) => p.player_id);
        const { data: playerRows, error: playerRowsErr } = await supabase
          .from("players")
          .select("id, tipo")
          .in("id", ids);
        if (playerRowsErr) throw playerRowsErr;

        const guestIds = new Set(
          (playerRows ?? []).filter((r: any) => r.tipo === "invitado").map((r: any) => r.id)
        );

        const contribs = uniquePlayers
          .filter((p) => p.presente !== false && !guestIds.has(p.player_id))
          .map((p) => ({
            match_id: matchId,
            player_id: p.player_id,
            monto: aporte,
            pagado: paidByPlayer.get(p.player_id) ?? false,
          }));
        if (contribs.length > 0) {
          const { error: cErr } = await supabase
            .from("contributions")
            .upsert(contribs, { onConflict: "match_id,player_id" });
          if (cErr) throw cErr;
        }
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["match_players", vars.matchId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["fondo"] });
      qc.invalidateQueries({ queryKey: ["match_contribution_amount", vars.matchId] });
    },
  });
};

export const useUpdateMatch = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...rest }: Partial<Match> & { id: string }) => {
      const { data, error } = await supabase.from("matches").update(rest).eq("id", id).select().single();
      if (error) throw error;
      const shouldApplyElo =
        (rest as any).estado !== "pendiente" &&
        ((rest as any).equipo_a_score !== undefined || (rest as any).equipo_b_score !== undefined);
      if (shouldApplyElo) {
        await applyMatchEloIfNeeded(id);
      }
      return data;
    },
    onSuccess: (data, vars) => {
      qc.setQueryData(["match", vars.id], data);
      qc.setQueryData(["matches"], (old: Match[] | undefined) =>
        old?.map((match) => (match.id === vars.id ? { ...match, ...data } : match))
      );
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["match", vars.id] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["chemistry"] });
    },
  });
};

export const useCloseMatchVoting = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (matchId: string) => {
      const [votesRes, mpRes, matchRes] = await Promise.all([
        supabase.from("votes").select("*").eq("match_id", matchId),
        supabase
          .from("match_players")
          .select("player_id, equipo, goles, asistencias, presente, player:players(tipo)")
          .eq("match_id", matchId),
        supabase.from("matches").select("id, equipo_a_score, equipo_b_score").eq("id", matchId).single(),
      ]);
      if (votesRes.error) throw votesRes.error;
      if (mpRes.error) throw mpRes.error;
      if (matchRes.error) throw matchRes.error;

      const votes = votesRes.data ?? [];
      const mp = (mpRes.data ?? []) as any[];
      const match = matchRes.data as any;
      const scoreA = Number(match.equipo_a_score ?? 0);
      const scoreB = Number(match.equipo_b_score ?? 0);
      const winnerTeam = scoreA > scoreB ? "A" : scoreB > scoreA ? "B" : null;

      const eligiblePlayerIds = new Set<string>();
      const mvpEligiblePlayerIds = new Set<string>();
      const stats = new Map<string, { goles: number; asistencias: number }>();
      mp.forEach((r) => {
        if (!r.presente || (r as any).player?.tipo === "invitado") return;
        eligiblePlayerIds.add(r.player_id);
        if (winnerTeam && r.equipo === winnerTeam) {
          mvpEligiblePlayerIds.add(r.player_id);
        }
        stats.set(r.player_id, { goles: r.goles, asistencias: r.asistencias });
      });

      const pickWinner = (type: "mvp" | "goal", eligibleIds: Set<string>): string | null => {
        const tally = new Map<string, number>();
        votes
          .filter((v) => v.type === type && eligibleIds.has(v.voted_player_id))
          .forEach((v) => {
            tally.set(v.voted_player_id, (tally.get(v.voted_player_id) ?? 0) + 1);
          });
        if (tally.size === 0) return null;
        const ranked = Array.from(tally.entries())
          .map(([pid, count]) => ({
            pid,
            count,
            goles: stats.get(pid)?.goles ?? 0,
            asist: stats.get(pid)?.asistencias ?? 0,
          }))
          .sort((a, b) => b.count - a.count || b.goles - a.goles || b.asist - a.asist);
        return ranked[0].pid;
      };
      const mvp = pickWinner("mvp", mvpEligiblePlayerIds);
      const gol = pickWinner("goal", eligiblePlayerIds);

      const { data, error } = await supabase
        .from("matches")
        .update({
          estado: "cerrado",
          mvp_player_id: mvp,
          gol_de_la_fecha_player_id: gol,
        })
        .eq("id", matchId)
        .select()
        .single();
      if (error) throw error;
      const eloResult = await applyMatchEloIfNeeded(matchId);
      return { match: data, mvp, gol, totalVotes: votes.length, eloUpdates: eloResult.eloUpdates };
    },
    onSuccess: (_, matchId) => {
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["match", matchId] });
      qc.invalidateQueries({ queryKey: ["votes", matchId] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
      qc.invalidateQueries({ queryKey: ["players"] });
      qc.invalidateQueries({ queryKey: ["chemistry"] });
    },
  });
};

export const useAutoCloseExpiredVoting = () => {
  const { data: matches = [] } = useMatches();
  const closeMut = useCloseMatchVoting();
  const closingIds = useRef(new Set<string>());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const expired = matches.filter((match) => isVotingExpiredForMatch(match, now) && !closingIds.current.has(match.id));
    if (expired.length === 0) return;

    let cancelled = false;
    const closeExpired = async () => {
      for (const match of expired) {
        if (cancelled) return;
        closingIds.current.add(match.id);
        try {
          await closeMut.mutateAsync(match.id);
        } catch (error) {
          closingIds.current.delete(match.id);
          console.error("No se pudo cerrar la votacion vencida", error);
        }
      }
    };

    void closeExpired();
    return () => {
      cancelled = true;
    };
  }, [matches, now, closeMut]);
};
