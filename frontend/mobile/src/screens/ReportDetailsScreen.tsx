/**
 * Report Details Screen — Full detail view for a community report.
 * Shown when user taps a report in Community list (modal or stack).
 *
 * Hooks must run unconditionally (never return before hooks) to avoid React internal errors.
 */
import React from "react";
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  Image,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "../theme/colors";
import { spacing } from "../theme/spacing";
import { AlertIcon, LocationIcon, AppIcon } from "../components/AppIcons";
import {
  addReportComment,
  fetchReportComments,
  voteOnReport,
} from "../services/api";
import { resolveMediaUrl } from "../utils/mediaUrl";

export interface ReportDetailsReport {
  id: string;
  type: string;
  category: string;
  description: string;
  severity: number;
  location: { latitude: number; longitude: number };
  timestamp: string;
  verified?: boolean;
  media_url?: string | null;
  votes?: { up: number; down: number };
  comment_count?: number;
}

interface ReportDetailsScreenProps {
  report: ReportDetailsReport | null;
  visible: boolean;
  onClose: () => void;
  onViewOnMap?: (lat: number, lng: number) => void;
  /** Keep Community list in sync after vote */
  onVotesUpdated?: (reportId: string, votes: { up: number; down: number }) => void;
  /** Refresh list after a new comment */
  onCommentsChanged?: (reportId: string) => void;
}

function getSeverityLabel(severity: number): string {
  if (severity >= 5) return "Critical";
  if (severity >= 4) return "High";
  if (severity >= 3) return "Medium";
  if (severity >= 2) return "Low";
  return "Very Low";
}

function getSeverityColor(severity: number): string {
  if (severity >= 4) return colors.danger;
  if (severity >= 3) return colors.warning;
  return colors.textSecondary;
}

function formatDateTime(timestamp: string): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportDetailsScreen({
  report,
  visible,
  onClose,
  onViewOnMap,
  onVotesUpdated,
  onCommentsChanged,
}: ReportDetailsScreenProps) {
  const [votes, setVotes] = React.useState<{ up: number; down: number }>({
    up: 0,
    down: 0,
  });
  const [comments, setComments] = React.useState<
    Array<{ id: string; user_id: string; text: string; created_at: string }>
  >([]);
  const [commentText, setCommentText] = React.useState("");
  const [loadingComments, setLoadingComments] = React.useState(false);
  const [submittingComment, setSubmittingComment] = React.useState(false);
  const [imageFailed, setImageFailed] = React.useState(false);

  React.useEffect(() => {
    if (!visible || !report?.id) return;
    setImageFailed(false);
    setVotes({
      up: report.votes?.up ?? 0,
      down: report.votes?.down ?? 0,
    });
    setCommentText("");
    setLoadingComments(true);
    fetchReportComments(report.id)
      .then((r) => {
        if (r?.success && Array.isArray(r.comments)) setComments(r.comments);
        else setComments([]);
      })
      .catch(() => setComments([]))
      .finally(() => setLoadingComments(false));
  }, [visible, report?.id]);

  const mediaUrl = report ? resolveMediaUrl(report.media_url) : null;

  const handleVote = async (value: 1 | -1) => {
    if (!report?.id) return;
    try {
      const r = await voteOnReport(report.id, value);
      if (r?.success && r?.votes) {
        const next = {
          up: Number(r.votes.up || 0),
          down: Number(r.votes.down || 0),
        };
        setVotes(next);
        onVotesUpdated?.(report.id, next);
      }
    } catch {
      // network/auth
    }
  };

  const handleAddComment = async () => {
    if (!report?.id) return;
    const text = commentText.trim();
    if (!text) return;
    setSubmittingComment(true);
    try {
      const r = await addReportComment(report.id, text);
      if (r?.success) {
        setCommentText("");
        if (r.comment && typeof r.comment === "object") {
          setComments((prev) => {
            const next = [...prev, r.comment as { id: string; user_id: string; text: string; created_at: string }];
            return next.sort(
              (a, b) =>
                new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });
        } else {
          const refreshed = await fetchReportComments(report.id);
          if (refreshed?.success && Array.isArray(refreshed.comments)) {
            setComments(refreshed.comments);
          }
        }
        onCommentsChanged?.(report.id);
      }
    } catch (e: any) {
      Alert.alert(
        "Comment failed",
        e?.message || "Could not post comment. Check you are logged in and the API is running."
      );
    } finally {
      setSubmittingComment(false);
    }
  };

  if (!report) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.backButton} accessibilityLabel="Close">
            <AppIcon name="arrow-back" size={24} color={colors.text} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Report Details</Text>
            <Text style={styles.subtitle}>Community incident report</Text>
          </View>
        </View>

        {/* Actions outside scroll — icon-only */}
        <View style={styles.toolbar}>
          <TouchableOpacity
            style={styles.toolbarBtn}
            onPress={() => handleVote(1)}
            accessibilityLabel="Upvote"
          >
            <AppIcon name="chevron-up-outline" size={26} color={colors.primary} />
            <Text style={styles.toolbarCount}>{votes.up}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.toolbarBtn}
            onPress={() => handleVote(-1)}
            accessibilityLabel="Downvote"
          >
            <AppIcon name="chevron-down-outline" size={26} color={colors.textSecondary} />
            <Text style={styles.toolbarCount}>{votes.down}</Text>
          </TouchableOpacity>
          <View style={styles.toolbarBtn} accessibilityLabel="Comments">
            <AppIcon name="chatbubble-ellipses-outline" size={22} color={colors.textSecondary} />
            <Text style={styles.toolbarCount}>
              {comments.length || report.comment_count || 0}
            </Text>
          </View>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          <View style={styles.card}>
            <View style={styles.summaryRow}>
              <View style={styles.alertIconWrap}>
                <AlertIcon size={24} color={colors.primary} />
              </View>
              <View style={styles.summaryMain}>
                <Text style={styles.categoryTitle}>{report.category}</Text>
                <Text style={styles.dateTime}>{formatDateTime(report.timestamp)}</Text>
              </View>
              <View style={[styles.severityTag, { backgroundColor: getSeverityColor(report.severity) }]}>
                <Text style={styles.severityTagText}>{getSeverityLabel(report.severity)}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Description</Text>
            <Text style={styles.descriptionText}>{report.description || "No description provided."}</Text>
          </View>

          {mediaUrl && !imageFailed && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Media</Text>
              <Image
                source={{ uri: mediaUrl }}
                style={styles.media}
                resizeMode="cover"
                onError={() => setImageFailed(true)}
              />
            </View>
          )}
          {mediaUrl && imageFailed && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Media</Text>
              <Text style={styles.mediaError}>
                Could not load image. Open in browser:{"\n"}
                {mediaUrl}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Comments</Text>
            <View style={styles.commentBox}>
              <TextInput
                value={commentText}
                onChangeText={setCommentText}
                placeholder="Add a comment (no personal info)…"
                placeholderTextColor={colors.textSecondary}
                style={styles.commentInput}
                multiline
              />
              <TouchableOpacity
                style={[styles.commentSubmit, submittingComment && styles.commentSubmitDisabled]}
                onPress={handleAddComment}
                disabled={submittingComment}
              >
                <Text style={styles.commentSubmitText}>{submittingComment ? "Posting…" : "Post"}</Text>
              </TouchableOpacity>
            </View>

            {loadingComments ? (
              <Text style={styles.commentsLoading}>Loading comments…</Text>
            ) : comments.length === 0 ? (
              <Text style={styles.commentsEmpty}>No comments yet.</Text>
            ) : (
              <View style={styles.commentsList}>
                {comments.slice(-20).map((c) => (
                  <View key={c.id} style={styles.commentItem}>
                    <Text style={styles.commentMeta}>
                      {new Date(c.created_at).toLocaleString()} • {c.user_id}
                    </Text>
                    <Text style={styles.commentText}>{c.text}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <LocationIcon size={20} color={colors.primary} />
              <Text style={styles.cardTitle}>Location</Text>
            </View>
            <Text style={styles.locationText}>
              {report.location.latitude.toFixed(4)}, {report.location.longitude.toFixed(4)}
            </Text>
            <View style={styles.mapPlaceholder}>
              <LocationIcon size={32} color={colors.danger} />
            </View>
            {onViewOnMap && (
              <TouchableOpacity
                style={styles.viewOnMapButton}
                onPress={() => onViewOnMap(report.location.latitude, report.location.longitude)}
              >
                <Text style={styles.viewOnMapText}>View on Map</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.card}>
            <View style={styles.cardTitleRow}>
              <Text style={styles.cardTitle}>Reported</Text>
            </View>
            <Text style={styles.reportedText}>{formatDateTime(report.timestamp)}</Text>
          </View>

          <View style={[styles.card, styles.advisoryCard]}>
            <View style={styles.cardTitleRow}>
              <AlertIcon size={20} color={colors.warning} />
              <Text style={styles.cardTitle}>Safety Advisory</Text>
            </View>
            <Text style={styles.advisoryText}>
              Exercise caution in this area. Consider using well-lit paths and avoid isolated spots when possible.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.backgroundSecondary,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  toolbarBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  toolbarCount: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.text,
    minWidth: 20,
  },
  backButton: {
    padding: spacing.sm,
    marginRight: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  card: {
    backgroundColor: colors.backgroundSecondary,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  alertIconWrap: {
    marginRight: spacing.sm,
  },
  summaryMain: {
    flex: 1,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: colors.text,
  },
  dateTime: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  severityTag: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 12,
  },
  severityTagText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.white,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: spacing.sm,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  descriptionText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
  media: {
    width: "100%",
    height: 220,
    borderRadius: 10,
    backgroundColor: colors.backgroundTertiary,
  },
  mediaError: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  commentBox: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.backgroundTertiary,
    padding: spacing.sm,
  },
  commentInput: {
    minHeight: 56,
    color: colors.text,
    fontSize: 14,
  },
  commentSubmit: {
    marginTop: spacing.sm,
    alignSelf: "flex-end",
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: 10,
  },
  commentSubmitDisabled: {
    opacity: 0.7,
  },
  commentSubmitText: {
    color: colors.white,
    fontWeight: "700",
  },
  commentsLoading: {
    marginTop: spacing.md,
    color: colors.textSecondary,
  },
  commentsEmpty: {
    marginTop: spacing.md,
    color: colors.textSecondary,
  },
  commentsList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  commentItem: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: spacing.sm,
    backgroundColor: colors.backgroundSecondary,
  },
  commentMeta: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  commentText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 20,
  },
  locationText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  mapPlaceholder: {
    height: 120,
    backgroundColor: colors.backgroundTertiary,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  viewOnMapButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
  },
  viewOnMapText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: "600",
  },
  reportedText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  advisoryCard: {
    backgroundColor: "#FFF8E7",
    borderColor: colors.warning + "60",
  },
  advisoryText: {
    fontSize: 14,
    color: colors.text,
    lineHeight: 22,
  },
});
