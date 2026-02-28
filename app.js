import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** SUPABASE DETAILS */
const SUPABASE_URL = "https://qzmhqadupwdyzutnufhc.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWhxYWR1cHdkeXp1dG51ZmhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzcxMTgsImV4cCI6MjA4NzgxMzExOH0.IzkC53QHKhTZ2fub-aqbbZda5svKJnEts4c6SCVeCX8"; // <-- replace this

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const msgBox = $("messages");

function msg(text) {
  msgBox.innerHTML = `<div class="msg">${text}</div>`;
}

function hide(el, yes = true) {
  el.classList.toggle("hidden", yes);
}

async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/* ---------------- PROFILE HELPERS ---------------- */

function xpNeeded(level) {
  return 100 * level; // infinite leveling
}

function maxStake(level) {
  return 10 + (level - 1) * 5;
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error) throw error;
  return data;
}

async function ensureProfile(user, usernameIfNew = null) {
  const { data: existing, error: e0 } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  // If there was an actual error (not just "no row"), surface it
  if (e0 && !existing && e0.code && e0.code !== "PGRST116") {
    throw e0;
  }

  if (existing) return existing;

  const username = usernameIfNew || user.email.split("@")[0];
  const { data, error } = await supabase
    .from("profiles")
    .insert([{ user_id: user.id, username }])
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

/* ---------------- HABITS ---------------- */

async function loadHabits(userId) {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: false }); // ✅ back to id (works even if no created_at)

  if (error) throw error;
  return data;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().split("T")[0];
}

function daysBetween(a, b) {
  const d1 = new Date(a + "T00:00:00Z");
  const d2 = new Date(b + "T00:00:00Z");
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

/* ---------------- UI REFRESH ---------------- */

async function refreshUI() {
  const user = await getSessionUser();

  if (!user) {
    hide($("auth"), false);
    hide($("app"), true);
    hide($("topbar"), true);
    return;
  }

  const profile = await loadProfile(user.id);
  const habits = await loadHabits(user.id);

  // Topbar with XP remaining + next level bonus
  const xpRequired = xpNeeded(profile.level);
  const xpRemaining = xpRequired - profile.xp;
  const nextLevel = profile.level + 1;

  $("topbar").innerHTML = `
    <div>
      <b>${profile.username}</b> |
      💰 £${Number(profile.balance).toFixed(2)} |
      ⭐ Level ${profile.level} (${profile.xp}/${xpRequired} XP) |
      ⏳ ${xpRemaining} XP to Level ${nextLevel} |
      🎁 Next Bonus: £${nextLevel} |
      Max stake £${maxStake(profile.level).toFixed(2)}
    </div>
    <button id="btnLogout">Logout</button>
  `;
  hide($("topbar"), false);

  $("btnLogout").onclick = async () => {
    await supabase.auth.signOut();
    msg("Logged out.");
    refreshUI();
  };

  /* -------- HABITS TABLE -------- */

  const tbody = $("habitsTable").querySelector("tbody");
  tbody.innerHTML = "";
  const today = todayISO();

  for (const h of habits) {
    const done = h.last_completed === today;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${h.name}</td>
      <td>${Number(h.stake).toFixed(2)}</td>
      <td>${h.streak}</td>
      <td>
        <button class="small" ${done ? "disabled" : ""} data-action="checkin" data-id="${h.id}">
          ${done ? "Done" : "Check In"}
        </button>
        <button class="small danger" data-action="delete" data-id="${h.id}">
          Delete
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  // ✅ UUID-safe: do NOT Number() the id
  tbody.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const habitId = btn.dataset.id; // UUID string
    const action = btn.dataset.action;

    if (action === "delete") await deleteHabit(user.id, habitId);
    if (action === "checkin") await checkinHabit(user.id, habitId);
  };

  /* -------- LEADERBOARD -------- */

  const lb = $("leaderboard").querySelector("tbody");
  const { data: leaders, error } = await supabase
    .from("profiles")
    .select("username, level, xp, balance")
    .order("level", { ascending: false })
    .order("xp", { ascending: false })
    .limit(50);

  if (error) throw error;

  lb.innerHTML = (leaders || [])
    .map(
      (u) =>
        `<tr>
          <td>${u.username}</td>
          <td>${u.level}</td>
          <td>${u.xp}</td>
          <td>£${Number(u.balance).toFixed(2)}</td>
        </tr>`
    )
    .join("");

  hide($("auth"), true);
  hide($("app"), false);
}

/* ---------------- HABIT ACTIONS ---------------- */

async function addHabit(userId, profile) {
  const name = $("habitName").value.trim();
  const stake = Number($("habitStake").value);

  if (!name) return msg("Enter habit name.");
  if (!stake || stake <= 0) return msg("Enter a stake > 0.");
  if (stake > maxStake(profile.level)) return msg("Stake exceeds your level cap.");
  if (stake > Number(profile.balance)) return msg("Not enough balance.");

  const newBalance = Number(profile.balance) - stake;

  const { error: e1 } = await supabase
    .from("profiles")
    .update({ balance: newBalance })
    .eq("user_id", userId);

  if (e1) throw e1;

  const { error: e2 } = await supabase
    .from("habits")
    .insert([{ user_id: userId, name, stake, streak: 0, last_completed: null }]);

  if (e2) throw e2;

  $("habitName").value = "";
  $("habitStake").value = "";
  msg("Habit added.");
  await refreshUI();
}

async function deleteHabit(userId, habitId) {
  const { data: habit, error: e1 } = await supabase
    .from("habits")
    .select("*")
    .eq("id", habitId)
    .single();
  if (e1) throw e1;

  const profile = await loadProfile(userId);
  const newBalance = Number(profile.balance) + Number(habit.stake);

  const { error: e2 } = await supabase
    .from("profiles")
    .update({ balance: newBalance })
    .eq("user_id", userId);
  if (e2) throw e2;

  const { error: e3 } = await supabase.from("habits").delete().eq("id", habitId);
  if (e3) throw e3;

  msg("Habit deleted. Stake refunded.");
  await refreshUI();
}

async function checkinHabit(userId, habitId) {
  const today = todayISO();

  const { data: h, error: e1 } = await supabase
    .from("habits")
    .select("*")
    .eq("id", habitId)
    .single();
  if (e1) throw e1;

  if (h.last_completed === today) return msg("Already checked in today.");

  let streak = h.streak || 0;
  let stake = Number(h.stake);
  let note = "";

  if (h.last_completed) {
    const diff = daysBetween(h.last_completed, today);
    if (diff === 1) streak += 1;
    else {
      streak = 1;
      stake *= 0.8;
      note = "⚠️ Missed a day! Stake reduced by 20%. ";
    }
  } else {
    streak = 1;
  }

  const dailyReward = Math.min(stake * 0.05 + stake * 0.02 * streak, stake * 0.25);

  const { error: e2 } = await supabase
    .from("habits")
    .update({ streak, stake, last_completed: today })
    .eq("id", habitId);
  if (e2) throw e2;

  const profile = await loadProfile(userId);

  // XP + infinite level-ups + £level bonus per level-up
  let xp = Number(profile.xp) + 10;
  let level = Number(profile.level);
  let levelUpReward = 0;

  while (xp >= xpNeeded(level)) {
    xp -= xpNeeded(level);
    level += 1;
    levelUpReward += level; // bonus equals the NEW level
  }

  const newBalance = Number(profile.balance) + dailyReward + levelUpReward;

  const { error: e3 } = await supabase
    .from("profiles")
    .update({ balance: newBalance, xp, level })
    .eq("user_id", userId);
  if (e3) throw e3;

  let message = `${note}Earned £${dailyReward.toFixed(2)} +10 XP!`;
  if (levelUpReward > 0) {
    message += ` 🎉 Leveled up! Bonus £${levelUpReward}!`;
  }

  msg(message);
  await refreshUI();
}

/* ---------------- AUTH ---------------- */

$("btnLogin").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return msg(error.message);

  msg("Logged in.");
  await refreshUI();
};

$("btnRegister").onclick = async () => {
  const email = $("email").value.trim();
  const password = $("password").value;
  const username = $("username").value.trim();

  if (!username) return msg("Enter a username for registration.");

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) return msg(error.message);

  const user = await getSessionUser();
  if (user) {
    await ensureProfile(user, username);
    msg("Registered and ready.");
    await refreshUI();
  } else {
    msg("Registered. Check your email to confirm, then login.");
  }
};

/* ---------------- INIT ---------------- */

(async () => {
  const user = await getSessionUser();
  if (user) await ensureProfile(user);

  $("btnAddHabit").onclick = async () => {
    const u = await getSessionUser();
    if (!u) return msg("Login first.");
    const profile = await loadProfile(u.id);
    await addHabit(u.id, profile);
  };

  supabase.auth.onAuthStateChange(async () => {
    const u2 = await getSessionUser();
    if (u2) await ensureProfile(u2);
    refreshUI();
  });

  refreshUI();
})();
