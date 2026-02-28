import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** 1) PUT YOUR SUPABASE DETAILS HERE */
const SUPABASE_URL = "https://qzmhqadupwdyzutnufhc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWhxYWR1cHdkeXp1dG51ZmhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzcxMTgsImV4cCI6MjA4NzgxMzExOH0.IzkC53QHKhTZ2fub-aqbbZda5svKJnEts4c6SCVeCX8";
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

/** Profiles helpers **/
function xpNeeded(level) {
  return 100 * level;
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

  if (e0) throw e0;
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

/** Habits **/
async function loadHabits(userId) {
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .eq("user_id", userId)
    .order("id", { ascending: false });

  if (error) throw error;
  return data;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysBetween(isoA, isoB) {
  const a = new Date(isoA + "T00:00:00Z");
  const b = new Date(isoB + "T00:00:00Z");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

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

  // --- TOPBAR (Logout fixed) ---
  $("topbar").innerHTML = `
    <div>
      <b>${profile.username}</b> |
      💰 ${Number(profile.balance).toFixed(2)} |
      ⭐ Level ${profile.level} (${profile.xp}/${xpNeeded(profile.level)} XP) |
      Max stake ${maxStake(profile.level).toFixed(2)}
    </div>
    <button id="btnLogout" type="button">Logout</button>
  `;
  hide($("topbar"), false);

  const logoutBtn = document.getElementById("btnLogout");
  logoutBtn.addEventListener("click", async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      msg("Logout failed: " + error.message);
      return;
    }
    msg("Logged out.");
    await refreshUI();
  });

  // --- HABITS TABLE ---
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
        <button class="small" ${
          done ? "disabled" : ""
        } data-action="checkin" data-id="${h.id}">${done ? "Done" : "Check In"}</button>
        <button class="small danger" data-action="delete" data-id="${h.id}">Delete</button>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.onclick = async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const id = Number(btn.dataset.id);
    const action = btn.dataset.action;

    if (action === "delete") await deleteHabit(user.id, id);
    if (action === "checkin") await checkinHabit(user.id, id);
  };

  // --- LEADERBOARD ---
  const lb = $("leaderboard").querySelector("tbody");
  const { data: leaders, error } = await supabase
    .from("profiles")
    .select("username, level, xp, balance")
    .order("level", { ascending: false })
    .order("xp", { ascending: false })
    .limit(50);

  if (error) throw error;

  lb.innerHTML = leaders
    .map(
      (u) =>
        `<tr><td>${u.username}</td><td>${u.level}</td><td>${u.xp}</td><td>${Number(
          u.balance
        ).toFixed(2)}</td></tr>`
    )
    .join("");

  hide($("auth"), true);
  hide($("app"), false);
}

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
      stake = stake * 0.8;
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

  let xp = profile.xp + 10;
  let level = profile.level;

  while (xp >= xpNeeded(level)) {
    xp -= xpNeeded(level);
    level += 1;
  }

  const newBalance = Number(profile.balance) + dailyReward;

  const { error: e3 } = await supabase
    .from("profiles")
    .update({ balance: newBalance, xp, level })
    .eq("user_id", userId);
  if (e3) throw e3;

  msg(`${note}Earned ${dailyReward.toFixed(2)} +10 XP!`);
  await refreshUI();
}

/** Auth buttons **/
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

/** On load **/
(async () => {
  // If already logged in, ensure profile exists
  const user = await getSessionUser();
  if (user) await ensureProfile(user);

  // Add habit button
  $("btnAddHabit").onclick = async () => {
    const u = await getSessionUser();
    if (!u) return msg("Login first.");
    const profile = await loadProfile(u.id);
    await addHabit(u.id, profile);
  };

  // React to auth changes
  supabase.auth.onAuthStateChange(async () => {
    const u2 = await getSessionUser();
    if (u2) await ensureProfile(u2);
    await refreshUI();
  });

  await refreshUI();
})();
