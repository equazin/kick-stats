import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { VOTING_WINDOW_MS } from "@/hooks/useMatches";

export type Vote = Database["public"]["Tables"]["votes"]["Row"];
export type VoteType = Database["public"]["Enums"]["vote_type"];

export const useVotes = (matchId?: string) =>
  useQuery({
    queryKey: ["votes", matchId],
    enabled: !!matchId,
    refetchInterval: matchId ? 10_000 : false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("votes")
        .select("*")
        .eq("match_id", matchId!);
      if (error) throw error;
      return data as Vote[];
    },
  });

export const useHasVoted = (matchId?: string, voterId?: string) =>
  useQuery({
    queryKey: ["votes", matchId, "by", voterId],
    enabled: !!matchId && !!voterId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("votes")
        .select("type")
        .eq("match_id", matchId!)
        .eq("voter_player_id", voterId!);
      if (error) throw error;
      const types = new Set((data ?? []).map((v) => v.type));
      return { mvp: types.has("mvp"), goal: types.has("goal") };
    },
  });

export interface CastVotesInput {
  matchId: string;
  voterId: string;
  mvpVotedId: string;
  goalVotedId: string;
}

export const useCastVotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, voterId, mvpVotedId, goalVotedId }: CastVotesInput) => {
      const rows = [
        { match_id: matchId, voter_player_id: voterId, voted_player_id: mvpVotedId, type: "mvp" as VoteType },
        { match_id: matchId, voter_player_id: voterId, voted_player_id: goalVotedId, type: "goal" as VoteType },
      ];
      // UPSERT sobre la constraint única (match_id, voter_player_id, type)
      // evita pérdida de datos si el insert falla a mitad
      const { error } = await supabase
        .from("votes")
        .upsert(rows, { onConflict: "match_id,voter_player_id,type" });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["votes", vars.matchId] });
      qc.invalidateQueries({ queryKey: ["votes", vars.matchId, "by", vars.voterId] });
    },
  });
};

export const useDeleteVote = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, voteId }: { matchId: string; voteId: string }) => {
      const { error } = await supabase.from("votes").delete().eq("id", voteId);
      if (error) throw error;
      return matchId;
    },
    onSuccess: (matchId) => {
      qc.invalidateQueries({ queryKey: ["votes", matchId] });
    },
  });
};

export const useDeleteVoterVotes = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ matchId, voterId }: { matchId: string; voterId: string }) => {
      const { error } = await supabase
        .from("votes")
        .delete()
        .eq("match_id", matchId)
        .eq("voter_player_id", voterId);
      if (error) throw error;
      return matchId;
    },
    onSuccess: (matchId) => {
      qc.invalidateQueries({ queryKey: ["votes", matchId] });
    },
  });
};

export const useResetMatchVoting = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (matchId: string) => {
      const now = new Date();
      const closesAt = new Date(now.getTime() + VOTING_WINDOW_MS);
      const { error: votesError } = await supabase.from("votes").delete().eq("match_id", matchId);
      if (votesError) throw votesError;

      const { error: matchError } = await supabase
        .from("matches")
        .update({
          estado: "jugado",
          mvp_player_id: null,
          gol_de_la_fecha_player_id: null,
          votacion_abre: now.toISOString(),
          votacion_cierra: closesAt.toISOString(),
        } as any)
        .eq("id", matchId);
      if (matchError) throw matchError;
    },
    onSuccess: (_, matchId) => {
      qc.invalidateQueries({ queryKey: ["votes", matchId] });
      qc.invalidateQueries({ queryKey: ["matches"] });
      qc.invalidateQueries({ queryKey: ["match", matchId] });
      qc.invalidateQueries({ queryKey: ["rankings"] });
    },
  });
};

/**
 * Cuenta votos por jugador, devuelve el ganador (con desempate por más votos, luego alfabético).
 */
export interface VoteTally {
  player_id: string;
  count: number;
}

export const tallyVotes = (votes: Vote[], type: VoteType): VoteTally[] => {
  const map = new Map<string, number>();
  votes.filter((v) => v.type === type).forEach((v) => {
    map.set(v.voted_player_id, (map.get(v.voted_player_id) ?? 0) + 1);
  });
  return Array.from(map.entries())
    .map(([player_id, count]) => ({ player_id, count }))
    .sort((a, b) => b.count - a.count);
};
