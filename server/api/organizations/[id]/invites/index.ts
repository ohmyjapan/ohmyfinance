// server/api/organizations/[id]/invites/index.ts
import { defineEventHandler, readBody, createError, getRouterParam } from 'h3'
import { ensureConnection } from '../../../../config/database'
import Organization from '../../../../models/Organization'
import Invite from '../../../../models/Invite'
import User from '../../../../models/User'
import { requireAuth } from '../../../../middleware/auth'
import { sendEmail } from '../../../../services/emailService'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const organizationId = getRouterParam(event, 'id')

  if (!organizationId) {
    throw createError({ statusCode: 400, statusMessage: 'Organization ID is required' })
  }

  await ensureConnection()

  // Find organization and check membership
  const organization = await Organization.findOne({
    _id: organizationId,
    'members.userId': auth.userId,
    isActive: true
  })

  if (!organization) {
    throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
  }

  const userMember = organization.members.find(
    m => m.userId.toString() === auth.userId
  )
  const userRole = userMember?.role || 'viewer'

  // Only owner and admin can manage invites
  if (!['owner', 'admin'].includes(userRole)) {
    throw createError({ statusCode: 403, statusMessage: 'Not authorized to manage invites' })
  }

  // GET - List pending invites
  if (event.method === 'GET') {
    try {
      // Update expired invites
      await Invite.updateMany(
        {
          organizationId,
          status: 'pending',
          expiresAt: { $lt: new Date() }
        },
        { $set: { status: 'expired' } }
      )

      const invites = await Invite.find({
        organizationId,
        status: 'pending'
      })
        .populate('createdBy', 'name email')
        .sort({ createdAt: -1 })
        .lean()

      return {
        success: true,
        invites: invites.map((invite: any) => ({
          id: invite._id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt,
          createdBy: invite.createdBy ? {
            id: invite.createdBy._id,
            name: invite.createdBy.name,
            email: invite.createdBy.email
          } : null
        }))
      }
    } catch (error: any) {
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  // POST - Create new invite
  if (event.method === 'POST') {
    try {
      const body = await readBody(event)
      const { email, role = 'member', sendEmailNotification = true } = body

      if (!email) {
        throw createError({ statusCode: 400, statusMessage: 'Email is required' })
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(email)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid email format' })
      }

      // Validate role
      if (!['admin', 'member', 'viewer'].includes(role)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid role' })
      }

      // Check if user is already a member
      const existingUser = await User.findOne({ email: email.toLowerCase() })
      if (existingUser) {
        const isMember = organization.members.some(
          m => m.userId.toString() === existingUser._id.toString()
        )
        if (isMember) {
          throw createError({ statusCode: 400, statusMessage: 'User is already a member of this organization' })
        }
      }

      // Check for existing pending invite
      const existingInvite = await Invite.findOne({
        email: email.toLowerCase(),
        organizationId,
        status: 'pending',
        expiresAt: { $gt: new Date() }
      })

      if (existingInvite) {
        throw createError({ statusCode: 400, statusMessage: 'An invitation has already been sent to this email' })
      }

      // Generate token and create invite
      const token = (Invite as any).generateToken()
      const expiresAt = new Date()
      expiresAt.setDate(expiresAt.getDate() + 7) // 7 days expiration

      const invite = await Invite.create({
        email: email.toLowerCase(),
        organizationId,
        role,
        token,
        expiresAt,
        createdBy: auth.userId,
        status: 'pending'
      })

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
      const inviteUrl = `${baseUrl}/auth/accept-invite?token=${token}`

      // Optionally send email notification
      if (sendEmailNotification) {
        await sendEmail({
          to: email,
          subject: `You've been invited to join ${organization.name} on OhMyFinance`,
          text: `
You've been invited to join ${organization.name} as a ${role}.

Click the link below to accept the invitation:
${inviteUrl}

This invitation will expire in 7 days.

If you didn't expect this invitation, you can safely ignore this email.

---
OhMyFinance Team
          `.trim(),
          html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #dc2626; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border-radius: 0 0 8px 8px; }
    .button { display: inline-block; background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0; }
    .footer { margin-top: 20px; font-size: 12px; color: #6b7280; text-align: center; }
    .role-badge { display: inline-block; background: #fee2e2; color: #dc2626; padding: 4px 12px; border-radius: 4px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2>Organization Invitation</h2>
    </div>
    <div class="content">
      <p>You've been invited to join <strong>${organization.name}</strong> on OhMyFinance.</p>
      <p>Role: <span class="role-badge">${role.charAt(0).toUpperCase() + role.slice(1)}</span></p>
      <p><a href="${inviteUrl}" class="button">Accept Invitation</a></p>
      <p>Or copy this link: <code>${inviteUrl}</code></p>
      <p style="color: #6b7280; font-size: 14px;">This invitation will expire in 7 days.</p>
    </div>
    <div class="footer">
      <p>If you didn't expect this invitation, you can safely ignore this email.</p>
      <p>OhMyFinance Team</p>
    </div>
  </div>
</body>
</html>
          `
        })
      }

      return {
        success: true,
        message: `Invitation sent to ${email}`,
        invite: {
          id: invite._id,
          email: invite.email,
          role: invite.role,
          status: invite.status,
          expiresAt: invite.expiresAt,
          createdAt: invite.createdAt
        },
        inviteUrl // Include for demo/testing purposes
      }
    } catch (error: any) {
      if (error.statusCode) throw error
      throw createError({ statusCode: 500, statusMessage: error.message })
    }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
