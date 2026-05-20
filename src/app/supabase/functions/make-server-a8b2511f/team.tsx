import * as kv from "./kv-retry.tsx";
import { getUserSubscriptionStatus } from "./contndr-billing.tsx";
import { sendEmail, sendSystemEmail } from "./email-sender.tsx";
import { PLAN_ENTITLEMENTS, normalizePlan } from "./plan-entitlements.ts";

// Seat-per-plan resolver. Single source of truth = plan-entitlements.ts so
// the team page never disagrees with the rest of the app. The old hardcoded
// table here was missing Scale and Enterprise (fell through to default 1),
// AND had stale values for Professional/Growth — both fixed by reading
// directly from PLAN_ENTITLEMENTS.
function getSeatLimit(plan: string): number {
  const key = normalizePlan(plan);
  return PLAN_ENTITLEMENTS[key].seats;
}

// Helper to get Team ID (Owner ID) for a user
export async function getTeamId(userId: string): Promise<string> {
  const teamId = await kv.get(`user:${userId}:team`);
  return teamId || userId;
}

/**
 * Returns an array of ALL user IDs on the same team (including the caller).
 * For solo users (no team), returns [userId].
 * Used for team-wide CRM dedup so members don't contact the same person.
 */
export async function getTeamMemberIds(userId: string): Promise<string[]> {
  const teamId = await getTeamId(userId);
  const members: any[] = await kv.get(`team:${teamId}:members`) || [];
  const ids = members.map((m: any) => m.id).filter(Boolean);
  // Always include the caller and the team owner
  const uniqueIds = new Set([userId, teamId, ...ids]);
  return Array.from(uniqueIds);
}

// Get Team Members and Limits
export async function getTeamMembers(user: any) {
  const userId = user.id;
  const teamId = await getTeamId(userId);
  const isOwner = teamId === userId;

  // Fetch members
  const memberIds = await kv.get(`team:${teamId}:members`) || [];
  
  let members = [];
  if (!memberIds || memberIds.length === 0) {
    // Default to just the owner if no team record
    members = [{ id: teamId, role: 'owner', email: '(You)', status: 'active' }];
  } else {
    members = memberIds;
  }
  
  // If we are the owner, ensure our record is up to date with fresh profile info
  if (isOwner) {
    const ownerIndex = members.findIndex((m: any) => m.id === userId);
    const ownerData = {
       id: userId,
       role: 'owner',
       email: user.email,
       name: user.user_metadata?.full_name || user.user_metadata?.name,
       avatar_url: user.user_metadata?.avatar_url,
       status: 'active'
    };

    if (ownerIndex === -1) {
       // Only happens if members list was synthesized or weird state
       if (members.length === 1 && members[0].email === '(You)') {
          members = [ownerData];
       } else {
          members.push(ownerData);
       }
    } else {
       // Update existing owner record
       members[ownerIndex] = {
         ...members[ownerIndex],
         ...ownerData
       };
    }
  }

  // Fetch invites
  const invites = await kv.get(`team:${teamId}:invites`) || [];

  // Get Subscription to determine limit
  let plan = 'starter';
  
  if (isOwner) {
    // If current user is owner, we can use their subscription status directly
    // This handles admin emails hardcoded in contndr-billing.tsx
    const status = await getUserSubscriptionStatus(user);
    if (status.status === 'active') {
      plan = status.plan;
    }
  } else {
    // If member, check KV for owner's subscription
    const sub = await kv.get(`contndr_sub:${teamId}`);
    if (sub && sub.status === 'active') {
      plan = sub.plan || 'starter';
    }
  }

  const limit = getSeatLimit(plan);
  const used = members.length + invites.length;

  return {
    teamId,
    isOwner,
    members,
    invites,
    plan,
    limit,
    usage: used
  };
}

// Invite Member
export async function inviteMember(user: any, email: string) {
  const userId = user.id;
  const teamId = await getTeamId(userId);
  
  // Only owner can invite
  if (teamId !== userId) {
    throw new Error("Only the team owner can invite members.");
  }

  // Check limits
  const { limit, usage } = await getTeamMembers(user);
  if (usage >= limit) {
    throw new Error(`Team limit reached for your plan. Upgrade to add more members.`);
  }

  // Check if email is already invited
  const invites = await kv.get(`team:${teamId}:invites`) || [];
  if (invites.find((i: any) => i.email.toLowerCase() === email.toLowerCase())) {
    throw new Error("User already invited.");
  }

  // Create invite token
  const token = crypto.randomUUID();
  const invite = {
    email: email.toLowerCase(),
    role: 'member',
    team_id: teamId,
    token,
    created_at: new Date().toISOString()
  };

  // Save invite
  await kv.set(`invite:${token}`, invite);
  
  // Add to team invites list
  const newInvites = [...invites, { ...invite, token }]; // Store token in list too for cancellation
  await kv.set(`team:${teamId}:invites`, newInvites);

  // Send Email
  const inviteLink = `https://contndr.com/accept-invite?token=${token}`;
  
  const inviterName = user.user_metadata?.full_name || user.user_metadata?.name || user.email;

  const emailResult = await sendSystemEmail({
    to: email,
    from: 'hello@contndr.com', 
    subject: `${inviterName} invited you to join their team on Contndr`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="font-size: 24px; font-weight: 700; color: #000; margin-bottom: 24px;">Contndr</h2>
        
        <p style="font-size: 16px; line-height: 1.5; color: #333;">Hi there,</p>
        
        <p style="font-size: 16px; line-height: 1.5; color: #333;"><strong>${inviterName}</strong> has invited you to join their team on Contndr.</p>
        
        <p style="font-size: 16px; line-height: 1.5; color: #333;">Contndr helps teams coordinate their cold outreach while keeping data isolated and secure.</p>
        
        <div style="margin: 32px 0;">
          <a href="${inviteLink}" style="display: inline-block; background-color: #000; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px;">Accept Invitation</a>
        </div>
        
        <p style="font-size: 14px; color: #666; margin-top: 32px; border-top: 1px solid #eee; padding-top: 20px;">
          If you didn't expect this invitation, you can ignore this email. The invitation link will expire in 7 days.
        </p>
      </div>
    `,
    text: `${inviterName} invited you to join their team on Contndr.\n\nAccept invitation: ${inviteLink}`
  });

  if (!emailResult.success) {
    // Undo save if email fails
    await kv.del(`invite:${token}`);
    await kv.set(`team:${teamId}:invites`, invites);
    throw new Error(`Failed to send invitation email: ${emailResult.error}`);
  }

  return { success: true, message: "Invitation sent" };
}

// Cancel Invite
export async function cancelInvite(userId: string, email: string) {
  const teamId = await getTeamId(userId);
  if (teamId !== userId) throw new Error("Unauthorized");

  const invites = await kv.get(`team:${teamId}:invites`) || [];
  const invite = invites.find((i: any) => i.email.toLowerCase() === email.toLowerCase());
  
  if (!invite) throw new Error("Invite not found");

  // Remove from list
  const newInvites = invites.filter((i: any) => i.email.toLowerCase() !== email.toLowerCase());
  await kv.set(`team:${teamId}:invites`, newInvites);

  // Remove token
  if (invite.token) {
    await kv.del(`invite:${invite.token}`);
  }

  return { success: true };
}

// Remove Member
export async function removeMember(userId: string, memberId: string) {
  const teamId = await getTeamId(userId);
  if (teamId !== userId) throw new Error("Unauthorized");

  if (memberId === userId) throw new Error("Cannot remove yourself (Owner)");

  const members = await kv.get(`team:${teamId}:members`) || [];
  const newMembers = members.filter((m: any) => m.id !== memberId);
  
  await kv.set(`team:${teamId}:members`, newMembers);

  // Unlink user
  await kv.del(`user:${memberId}:team`); // Or set to null, effectively making them solo again

  return { success: true };
}

// Accept Invite
export async function acceptInvite(user: any, token: string) {
  const userId = user.id;
  const userEmail = user.email || '';

  const invite = await kv.get(`invite:${token}`);
  if (!invite) throw new Error("Invalid or expired invitation");

  if (invite.email.toLowerCase() !== userEmail.toLowerCase()) {
    throw new Error("This invitation was sent to a different email address.");
  }

  const teamId = invite.team_id;

  // Add to team members
  // We need to store user info in the member list
  const members = await kv.get(`team:${teamId}:members`) || [{ id: teamId, role: 'owner', email: 'Owner', status: 'active' }];
  
  // Check if already a member
  if (members.find((m: any) => m.id === userId)) {
    // Already member, just cleanup invite
    await kv.del(`invite:${token}`);
    // Cleanup from invites list
    const invites = await kv.get(`team:${teamId}:invites`) || [];
    const newInvites = invites.filter((i: any) => i.token !== token);
    await kv.set(`team:${teamId}:invites`, newInvites);
    return { success: true, message: "Already a member" };
  }

  const newMember = {
    id: userId,
    email: userEmail,
    role: invite.role,
    name: user.user_metadata?.full_name || user.user_metadata?.name,
    avatar_url: user.user_metadata?.avatar_url,
    status: 'active',
    joined_at: new Date().toISOString()
  };

  await kv.set(`team:${teamId}:members`, [...members, newMember]);

  // Link user to team
  await kv.set(`user:${userId}:team`, teamId);

  // Remove invite
  await kv.del(`invite:${token}`);
  
  // Remove from invites list
  const invites = await kv.get(`team:${teamId}:invites`) || [];
  const newInvites = invites.filter((i: any) => i.token !== token);
  await kv.set(`team:${teamId}:invites`, newInvites);

  return { success: true, message: "Joined team successfully" };
}