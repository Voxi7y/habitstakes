import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/** PUT YOUR SUPABASE DETAILS HERE */
const SUPABASE_URL = "https://qzmhqadupwdyzutnufhc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6bWhxYWR1cHdkeXp1dG51ZmhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIyMzcxMTgsImV4cCI6MjA4NzgxMzExOH0.IzkC53QHKhTZ2fub-aqbbZda5svKJnEts4c6SCVeCX8";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);
const msgBox = $("messages");

function msg(text) {
  if (msgBox) msgBox.innerHTML = `<div class="msg">${text}</div>`;
}

function hide(el, yes = true) {
  if (!el) return;
  el.classList.toggle("hidden", yes);
}

async function getSessionUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** Helpers */
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

/** GLOBAL CLICK HANDLER (Logout + table buttons) */
document.addEventListener("click", async (e) => {
  const target = e.target;

  // Logout button anywhere
  if (target && target.id === "btnLogout") {
    try {
      msg("Logging out...");
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) {
        msg("Logout failed: " + error.message);
        return;
      }

      // Force-check session is gone
      const u = await getSessionUser();
      if (u) {
        msg("Logout clicked but session still exists. Cache/storage issue. Clear site data.");
      } else {
        msg("Logged out.");
      }
      await refreshUI();
    } catch (err) {
      msg("Logout crashed: " + (err?.message || String(err)));
    }
    return;
  }

  // Habits actions (Check In / Delete)
  if (target && target.dataset && target.dataset.action && target.dataset.id) {
    const action = target.dataset.action;
    const id = Number(target.dataset.id);
    const user = await getSessionUser();
    if (!user) {
      msg("Login first.");
      await refreshUI();
      return;
    }

    if (action === "delete") await deleteHabit(user.id, id);
    if (action === "checkin") await checkinHabit(user.id, id);
  }
});

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

  // Topbar (no onclick wiring needed now)
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

  // Habits table
  const tbody = $("habitsTable")?.querySelector("tbody");
  if (tbody) {
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
          <button class="small danger" data-action="delete" data-id="${h.id}">Delete</button>
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  // Leaderboard
  const lb = $("leaderboard")?.querySelector("tbody");
  if (lb) {
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
          `<tr><td>${u.username}</td><td>${u.level}</td><td>${u.xp}</td><td>${Number(u.balance).toFixed(2)}</td></tr>`
/** Wire auth + add habit */
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
    await refreshUI();
  });

  await refreshUI();
})();
