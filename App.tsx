import React, { useState, useRef, useMemo } from "react";
import {
  SafeAreaView,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";
import MaterialCommunityIcons from "react-native-vector-icons/MaterialCommunityIcons";
import Ionicons from "react-native-vector-icons/Ionicons";
import FontAwesome5 from "react-native-vector-icons/FontAwesome5";

/**
 * ⚠️ SECURITY NOTE — READ BEFORE SHIPPING
 * --------------------------------------------------
 * Never hardcode a real API key in client code, and never commit
 * one to a repo (public or private) — keys in shipped apps can be
 * extracted from the build. For production, proxy this call through
 * your own backend, keep the key server-side in an environment
 * variable, and have the app call YOUR endpoint instead of OpenAI's
 * directly. The placeholder below is intentionally not a working key.
 */
const OPENAI_API_KEY = ""; //replace with your own api key

const NUDGE_CATEGORIES = ["News", "Concept", "Tool", "Tip", "Did You Know"] as const;
type NudgeCategory = (typeof NUDGE_CATEGORIES)[number];

const SYSTEM_PROMPT_NUDGE = `You are the content engine for Nudgify AI Pro, an app that gives everyday people one short, useful "nudge" of AI knowledge per day.

Respond with ONLY a raw JSON array — no markdown fences, no preamble, no explanation. The array must contain exactly 6 objects, each shaped like:
{"category": "News" | "Concept" | "Tool" | "Tip" | "Did You Know", "title": "short punchy headline, under 8 words", "body": "1-3 plain-language sentences, under 240 characters, no jargon unless immediately explained"}

Guidelines:
- Write for a curious non-technical adult who wants to stay AI-literate without becoming an engineer.
- Mix the 6 items across categories — do not repeat a category more than twice.
- "News" items should describe the kind of thing that is plausibly true of the current AI landscape in general terms; never invent a fake specific event, company announcement, or statistic presented as fact. Prefer durable, broadly-true observations over claims that could be stale by the time the user reads them.
- "Concept" items explain one AI idea simply (e.g. what a token is, what fine-tuning means).
- "Tool" items describe a category of AI tool and what it's useful for, without fabricating product names you are not confident are real.
- "Tip" items are a practical thing the user can do today with AI.
- "Did You Know" items are a genuinely interesting, true-to-the-best-of-your-knowledge fact about AI.
- Never invent fake statistics, fake company names, or fake product names.
- No emoji, no markdown symbols like ** or #.`;

const SYSTEM_PROMPT_ASK = `You are Nudgify AI Pro's Ask AI assistant. You help everyday people — not just engineers — understand artificial intelligence: what it is, how it works, the tools available, how it affects daily life and work, and how to use it well and safely.

Guidelines:
- Keep answers clear, jargon-light, and conversational. Explain any technical term you use the first time, in plain words.
- Be practical: where it helps, give a concrete example or a step the person can actually take.
- Keep most answers focused and skimmable — short paragraphs, and "-" bullet points when listing things. No markdown symbols like ** or #, since this renders as plain text.
- If asked about something outside AI entirely, answer briefly and gently steer back to how AI might relate to it.
- Never invent fake tools, companies, papers, or statistics. If you're not sure something is current or accurate, say so plainly instead of guessing.
- Be encouraging and non-condescending — assume the person is smart and simply new to the topic, not an expert.`;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type NudgeItem = {
  category: NudgeCategory;
  title: string;
  body: string;
};

const ASK_SUGGESTIONS = [
  { label: "What is a large language model?", icon: "brain" },
  { label: "Is AI going to take my job?", icon: "briefcase-alert-outline" },
  { label: "How do I write better AI prompts?", icon: "creation" },
  { label: "How can AI help me at work today?", icon: "lightning-bolt-outline" },
  { label: "What's the difference between AI and ML?", icon: "compare-horizontal" },
  { label: "How do I spot AI-generated content?", icon: "magnify-scan" },
];

const CATEGORY_STYLE: Record<NudgeCategory, { color: string; icon: string }> = {
  News: { color: "#3B5BFF", icon: "newspaper-variant-outline" },
  Concept: { color: "#5B4FE9", icon: "brain" },
  Tool: { color: "#0EA5A5", icon: "toolbox-outline" },
  Tip: { color: "#E08900", icon: "star-four-points-outline" },
  "Did You Know": { color: "#D1399A", icon: "help-circle-outline" },
};

const todayLabel = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

const todayISO = () => new Date().toISOString().slice(0, 10);

const callOpenAI = async (systemPrompt: string, userContent: string) => {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      max_tokens: 1600,
      temperature: 0.5,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(JSON.stringify(data?.error?.message ?? data));
  }
  return data?.choices?.[0]?.message?.content ?? "";
};

const parseNudgeJSON = (raw: string): NudgeItem[] => {
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
  return parsed
    .filter((item) => item && item.category && item.title && item.body)
    .map((item) => ({
      category: NUDGE_CATEGORIES.includes(item.category) ? item.category : "Concept",
      title: String(item.title),
      body: String(item.body),
    }));
};

const App = () => {
  const [activeTab, setActiveTab] = useState<"nudge" | "ask">("nudge");

  // Nudge tab state
  const [nudges, setNudges] = useState<NudgeItem[]>([]);
  const [nudgeDateISO, setNudgeDateISO] = useState<string | null>(null);
  const [loadingNudges, setLoadingNudges] = useState(false);

  // Ask tab state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [loadingChat, setLoadingChat] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const isStale = useMemo(() => nudgeDateISO !== todayISO(), [nudgeDateISO]);

  const fetchNudges = async () => {
    setLoadingNudges(true);
    try {
      const raw = await callOpenAI(
        SYSTEM_PROMPT_NUDGE,
        `Give me today's 6 AI nudges. Today is ${todayLabel()}.`
      );
      const parsed = parseNudgeJSON(raw);
      setNudges(parsed);
      setNudgeDateISO(todayISO());
    } catch (err) {
      Alert.alert("Couldn't load today's nudge", String(err));
    } finally {
      setLoadingNudges(false);
    }
  };

  const sendMessage = async (text?: string) => {
    const userText = (text ?? inputText).trim();
    if (!userText) return;

    const newMessages: ChatMessage[] = [...messages, { role: "user", content: userText }];
    setMessages(newMessages);
    setInputText("");
    setLoadingChat(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      const reply = await callOpenAI(
        SYSTEM_PROMPT_ASK,
        newMessages.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n")
      );
      setMessages([
        ...newMessages,
        { role: "assistant", content: reply || "Sorry, I couldn't generate a reply. Please try again." },
      ]);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (err) {
      Alert.alert("Something went wrong", String(err));
    } finally {
      setLoadingChat(false);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    Clipboard.setString(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const clearChat = () => {
    Alert.alert("New conversation", "Clear this chat and start fresh?", [
      { text: "Cancel", style: "cancel" },
      { text: "Start Fresh", onPress: () => setMessages([]) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIconBox}>
            <MaterialCommunityIcons name="bell-ring-outline" size={22} color="#fff" />
          </View>
          <View>
            <Text style={styles.headerTitle}>Nudgify AI Pro</Text>
            <Text style={styles.headerSub}>Everyday AI, one nudge at a time</Text>
          </View>
        </View>
        {activeTab === "ask" && messages.length > 0 && (
          <TouchableOpacity onPress={clearChat} style={styles.headerBtn}>
            <Ionicons name="refresh-outline" size={16} color="#fff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "nudge" && styles.tabBtnActive]}
          onPress={() => setActiveTab("nudge")}
        >
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={16}
            color={activeTab === "nudge" ? "#fff" : PRIMARY}
          />
          <Text style={[styles.tabBtnText, activeTab === "nudge" && styles.tabBtnTextActive]}>
            {"  "}Today's Nudge
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, activeTab === "ask" && styles.tabBtnActive]}
          onPress={() => setActiveTab("ask")}
        >
          <Ionicons
            name="chatbubble-ellipses-outline"
            size={16}
            color={activeTab === "ask" ? "#fff" : PRIMARY}
          />
          <Text style={[styles.tabBtnText, activeTab === "ask" && styles.tabBtnTextActive]}>
            {"  "}Ask AI
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === "nudge" ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {nudges.length > 0 && (
            <View style={styles.nudgeHeaderRow}>
              <View>
                <Text style={styles.nudgeHeaderDate}>{todayLabel()}</Text>
                {isStale && <Text style={styles.nudgeStaleText}>You're viewing an older nudge</Text>}
              </View>
              <TouchableOpacity
                style={styles.refreshBtn}
                onPress={fetchNudges}
                disabled={loadingNudges}
              >
                {loadingNudges ? (
                  <ActivityIndicator size="small" color={PRIMARY} />
                ) : (
                  <>
                    <Ionicons name="refresh-outline" size={14} color={PRIMARY} />
                    <Text style={styles.refreshBtnText}>  Refresh</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}

          {nudges.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconRing}>
                <MaterialCommunityIcons name="bell-ring-outline" size={48} color="#fff" />
              </View>
              <Text style={styles.emptyTitle}>{todayLabel()}</Text>
              <Text style={styles.emptyText}>
                Get six bite-sized AI nudges for today — news, concepts, tools, tips, and
                interesting facts, all in plain language.
              </Text>
              <TouchableOpacity
                style={styles.emptyCta}
                onPress={fetchNudges}
                disabled={loadingNudges}
              >
                {loadingNudges ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.emptyCtaText}>Get Today's Nudge</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            nudges.map((n, i) => {
              const style = CATEGORY_STYLE[n.category];
              return (
                <View key={i} style={styles.nudgeCard}>
                  <View style={[styles.nudgeBadge, { backgroundColor: style.color }]}>
                    <MaterialCommunityIcons name={style.icon} size={12} color="#fff" />
                    <Text style={styles.nudgeBadgeText}>  {n.category}</Text>
                  </View>
                  <Text style={styles.nudgeTitle}>{n.title}</Text>
                  <Text style={styles.nudgeBody}>{n.body}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.messagesContainer}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
          >
            {messages.length === 0 ? (
              <View style={styles.welcomeContainer}>
                <View style={styles.welcomeIconRing}>
                  <Ionicons name="chatbubble-ellipses-outline" size={48} color="#fff" />
                </View>
                <Text style={styles.welcomeTitle}>Ask AI</Text>
                <Text style={styles.welcomeText}>
                  Ask anything about artificial intelligence — concepts, tools, news, or how
                  to use it in everyday life. Plain language, no jargon left unexplained.
                </Text>
                <Text style={styles.suggestionsLabel}>Try one of these:</Text>
                <View style={styles.suggestionsGrid}>
                  {ASK_SUGGESTIONS.map((s, i) => (
                    <TouchableOpacity
                      key={i}
                      style={styles.suggestionChip}
                      onPress={() => sendMessage(s.label)}
                    >
                      <MaterialCommunityIcons
                        name={s.icon}
                        size={13}
                        color={PRIMARY}
                        style={{ marginRight: 5 }}
                      />
                      <Text style={styles.suggestionText}>{s.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              messages.map((msg, index) => (
                <View
                  key={index}
                  style={msg.role === "user" ? styles.userBubbleWrap : styles.aiBubbleWrap}
                >
                  {msg.role === "assistant" && (
                    <View style={styles.aiLabelRow}>
                      <MaterialCommunityIcons name="bell-ring-outline" size={13} color={PRIMARY} />
                      <Text style={styles.aiLabel}>  Nudgify AI Pro</Text>
                    </View>
                  )}
                  {msg.role === "user" ? (
                    <View style={styles.userBubble}>
                      <Text style={styles.userText}>{msg.content}</Text>
                    </View>
                  ) : (
                    <View style={styles.sectionCard}>
                      <Text style={styles.aiText}>{msg.content}</Text>
                      <TouchableOpacity
                        style={styles.copyBtn}
                        onPress={() => copyToClipboard(msg.content, index)}
                      >
                        <Ionicons
                          name={copiedIndex === index ? "checkmark-circle" : "copy-outline"}
                          size={13}
                          color={copiedIndex === index ? PRIMARY : "#aaa"}
                        />
                        <Text
                          style={[styles.copyBtnText, copiedIndex === index && { color: PRIMARY }]}
                        >
                          {copiedIndex === index ? "  Copied!" : "  Copy"}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))
            )}

            {loadingChat && (
              <View style={styles.aiBubbleWrap}>
                <View style={styles.aiLabelRow}>
                  <MaterialCommunityIcons name="bell-ring-outline" size={13} color={PRIMARY} />
                  <Text style={styles.aiLabel}>  Nudgify AI Pro</Text>
                </View>
                <View style={styles.sectionCard}>
                  <ActivityIndicator size="small" color={PRIMARY} />
                  <Text style={styles.typingText}>  Thinking...</Text>
                </View>
              </View>
            )}
          </ScrollView>

          {/* Input bar */}
          <View style={styles.inputContainer}>
            <FontAwesome5 name="robot" size={15} color={PRIMARY} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Ask anything about AI..."
              placeholderTextColor="#aaa"
              value={inputText}
              onChangeText={setInputText}
              multiline
              maxLength={1000}
              onSubmitEditing={() => sendMessage()}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!inputText.trim() || loadingChat) && styles.sendBtnDisabled]}
              onPress={() => sendMessage()}
              disabled={!inputText.trim() || loadingChat}
            >
              <Ionicons
                name="arrow-up"
                size={20}
                color={!inputText.trim() || loadingChat ? "#aaa" : "#fff"}
              />
              </TouchableOpacity>
            </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
};

export default App;

const BG = "#ffffff";
const SURFACE = "#f1efff";
const BORDER = "#dcd7fb";
const PRIMARY = "#5B4FE9";
const ACCENT = "#FFB100";

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: PRIMARY,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  headerIconBox: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { fontSize: 15, fontWeight: "800", color: "#fff" },
  headerSub: { fontSize: 12, color: "rgba(255,255,255,0.78)", fontWeight: "500" },
  headerBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },

  // Tabs
  tabBar: {
    flexDirection: "row",
    padding: 6,
    margin: 12,
    backgroundColor: SURFACE,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: PRIMARY },
  tabBtnText: { fontSize: 13, fontWeight: "700", color: PRIMARY },
  tabBtnTextActive: { color: "#fff" },

  // Nudge tab
  nudgeHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  nudgeHeaderDate: { fontSize: 16, fontWeight: "800", color: "#222" },
  nudgeStaleText: { fontSize: 11, color: "#999", marginTop: 2 },
  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BORDER,
    minWidth: 36,
    justifyContent: "center",
  },
  refreshBtnText: { color: PRIMARY, fontSize: 12, fontWeight: "700" },

  emptyState: { alignItems: "center", paddingTop: 30, paddingHorizontal: 12 },
  emptyIconRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  emptyTitle: { fontSize: 20, fontWeight: "800", color: "#222" },
  emptyText: {
    fontSize: 14,
    color: "#777",
    textAlign: "center",
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 22,
  },
  emptyCta: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 26,
    paddingVertical: 13,
    borderRadius: 24,
    minWidth: 180,
    alignItems: "center",
  },
  emptyCtaText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  nudgeCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 15,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },
  nudgeBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 9,
  },
  nudgeBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  nudgeTitle: { fontSize: 16, fontWeight: "800", color: "#222", marginBottom: 5 },
  nudgeBody: { fontSize: 14, color: "#555", lineHeight: 20 },

  // Ask tab — welcome
  messagesContainer: { flex: 1 },
  messagesContent: { padding: 16, paddingTop: 4, paddingBottom: 8 },
  welcomeContainer: { alignItems: "center", paddingTop: 16 },
  welcomeIconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
  },
  welcomeTitle: { fontSize: 22, fontWeight: "800", color: PRIMARY, marginBottom: 10 },
  welcomeText: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 18,
    paddingHorizontal: 6,
  },
  suggestionsLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "600",
    marginBottom: 12,
    alignSelf: "flex-start",
  },
  suggestionsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  suggestionChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: BORDER,
  },
  suggestionText: { color: PRIMARY, fontSize: 13, fontWeight: "600" },

  // Chat bubbles
  userBubbleWrap: { alignItems: "flex-end", marginBottom: 16 },
  aiBubbleWrap: { alignItems: "flex-start", marginBottom: 16, width: "100%" },
  aiLabelRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  aiLabel: { fontSize: 12, color: PRIMARY, fontWeight: "600" },
  userBubble: {
    backgroundColor: PRIMARY,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: "85%",
  },
  sectionCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: "100%",
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  userText: { color: "#fff", fontSize: 15, lineHeight: 22 },
  aiText: { color: "#222", fontSize: 14, lineHeight: 22 },
  typingText: { color: "#aaa", fontSize: 14, fontStyle: "italic", marginLeft: 6 },
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 10,
    paddingHorizontal: 4,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  copyBtnText: { color: "#aaa", fontSize: 12, fontWeight: "600" },

  // Input
  inputContainer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
    backgroundColor: BG,
    gap: 8,
  },
  inputIcon: { paddingBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: SURFACE,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#222",
    fontSize: 15,
    borderWidth: 1,
    borderColor: BORDER,
    maxHeight: 120,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnDisabled: { backgroundColor: BORDER },
});