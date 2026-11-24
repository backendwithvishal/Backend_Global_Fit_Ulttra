import crypto from 'crypto';
import { logger } from '../config/logger.js';

export class OrganizationService {
    constructor({ organizationRepository, invitationRepository, userRepository, emailService = null }) {
        this.organizationRepository = organizationRepository;
        this.invitationRepository = invitationRepository;
        this.userRepository = userRepository;
        this.emailService = emailService;
    }

    async createOrganization(ownerId, name) {
        try {
            // Generate clean slug from name
            let slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            if (!slug) slug = 'workspace';
            
            // Check slug uniqueness
            let checkSlug = slug;
            let counter = 1;
            while (await this.organizationRepository.findBySlug(checkSlug)) {
                checkSlug = `${slug}-${counter}`;
                counter++;
            }

            const org = await this.organizationRepository.create({
                name,
                slug: checkSlug,
                ownerId,
                members: [{
                    userId: ownerId,
                    role: 'Owner',
                    joinedAt: new Date()
                }]
            });

            return org;
        } catch (error) {
            logger.error('Error in createOrganization', { ownerId, name, error: error.message });
            throw error;
        }
    }

    async getOrganization(orgId) {
        return this.organizationRepository.findById(orgId);
    }

    async getUserOrganizations(userId) {
        return this.organizationRepository.findByUserId(userId);
    }

    async inviteMember(orgId, invitedById, email, role = 'Member') {
        try {
            const org = await this.organizationRepository.findById(orgId);
            if (!org) {
                const err = new Error('Organization not found');
                err.status = 404;
                throw err;
            }

            // Check if invitedById is Owner or Admin
            const actorMember = org.members.find(m => {
                const uId = (m.userId?._id || m.userId)?.toString();
                return uId === invitedById.toString();
            });
            const isOwner = org.ownerId && org.ownerId.toString() === invitedById.toString();
            if (!isOwner && (!actorMember || !['Owner', 'Admin'].includes(actorMember.role))) {
                const err = new Error('Unauthorized. Only Owners and Admins can invite members.');
                err.status = 403;
                throw err;
            }

            const normalizedEmail = String(email).trim().toLowerCase();

            // Check if email already in organization
            const isAlreadyMember = org.members.some(m => {
                const mEmail = (m.userId?.email || '').trim().toLowerCase();
                return mEmail === normalizedEmail;
            });
            if (isAlreadyMember) {
                throw new Error('User is already a member of this organization');
            }

            // Check if active pending invitation exists
            const existingInvite = await this.invitationRepository.findByEmailAndOrg(normalizedEmail, orgId);
            if (existingInvite) {
                throw new Error('An active invitation is already pending for this user');
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

            const invite = await this.invitationRepository.create({
                organizationId: orgId,
                email: normalizedEmail,
                role,
                token,
                invitedById,
                expiresAt,
            });

            if (this.emailService) {
                await this.emailService.sendInvitationEmail(normalizedEmail, org.name, token).catch(err => {
                    logger.warn('Failed to send invitation email', { error: err.message });
                });
            } else {
                logger.info('[INVITATION LINK]', { orgName: org.name, email: normalizedEmail, token });
            }

            return invite;
        } catch (error) {
            logger.error('Error in inviteMember', { orgId, email, error: error.message });
            throw error;
        }
    }

    async acceptInvitation(token, userId) {
        try {
            if (!token) {
                throw new Error('Invalid or expired invitation token');
            }

            const invite = await this.invitationRepository.findByToken(decodeURIComponent(token).trim());
            if (!invite) {
                throw new Error('Invalid or expired invitation token');
            }

            if (new Date() > invite.expiresAt) {
                await this.invitationRepository.updateStatus(invite._id, 'Expired');
                throw new Error('Invitation has expired');
            }

            const user = await this.userRepository.findById(userId);
            if (!user) {
                const err = new Error('User not found');
                err.status = 404;
                throw err;
            }

            const userEmail = String(user.email || '').trim().toLowerCase();
            const inviteEmail = String(invite.email || '').trim().toLowerCase();

            if (userEmail !== inviteEmail) {
                throw new Error('Invitation email does not match logged-in user');
            }

            // Add user to organization
            const org = await this.organizationRepository.addMember(invite.organizationId._id || invite.organizationId, userId, invite.role);
            
            // Mark invitation accepted
            await this.invitationRepository.updateStatus(invite._id, 'Accepted');

            logger.info('Invitation accepted successfully', { orgId: invite.organizationId._id || invite.organizationId, userId });
            return org;
        } catch (error) {
            logger.error('Error in acceptInvitation', { token, userId, error: error.message });
            throw error;
        }
    }

    async removeMember(orgId, userId, actorId) {
        try {
            const org = await this.organizationRepository.findById(orgId);
            if (!org) {
                throw new Error('Organization not found');
            }

            const actorMember = org.members.find(m => m.userId._id.toString() === actorId.toString());
            if (!actorMember || !['Owner', 'Admin'].includes(actorMember.role)) {
                throw new Error('Unauthorized');
            }

            const targetMember = org.members.find(m => m.userId._id.toString() === userId.toString());
            if (!targetMember) {
                throw new Error('User is not a member of this organization');
            }

            // Prevent removing the Owner
            if (targetMember.role === 'Owner') {
                throw new Error('Cannot remove the organization owner');
            }

            // Prevent Admins from removing other Admins or Owners
            if (actorMember.role === 'Admin' && ['Owner', 'Admin'].includes(targetMember.role)) {
                throw new Error('Admins cannot remove owners or other admins');
            }

            return await this.organizationRepository.removeMember(orgId, userId);
        } catch (error) {
            logger.error('Error in removeMember', { orgId, userId, actorId, error: error.message });
            throw error;
        }
    }

    async updateMemberRole(orgId, memberOrUserId, newRole, actorId, actorRole = '') {
        try {
            const org = await this.organizationRepository.findById(orgId);
            if (!org) {
                const err = new Error('Organization not found');
                err.status = 404;
                throw err;
            }

            const isOwner = org.ownerId && org.ownerId.toString() === actorId.toString();
            const normalizedActorRole = String(actorRole || '').toLowerCase().replace(/[-_]/g, '');
            const isSystemAdmin = normalizedActorRole === 'admin' || normalizedActorRole === 'superadmin';

            const actorMember = org.members.find(m => {
                const uId = (m.userId?._id || m.userId)?.toString();
                return uId === actorId.toString();
            });

            const isOrgAdmin = actorMember && ['Owner', 'Admin'].includes(actorMember.role);
            if (!isOwner && !isOrgAdmin && !isSystemAdmin) {
                const err = new Error('Unauthorized');
                err.status = 403;
                throw err;
            }

            const targetMember = org.members.find(m => {
                const uId = (m.userId?._id || m.userId)?.toString();
                const subId = m._id ? m._id.toString() : null;
                return uId === memberOrUserId.toString() || (subId && subId === memberOrUserId.toString());
            });

            if (!targetMember) {
                const err = new Error('User is not a member of this organization');
                err.status = 404;
                throw err;
            }

            // Prevent altering the Owner's role
            if (targetMember.role === 'Owner') {
                const err = new Error('Cannot change the role of the organization owner');
                err.status = 403;
                throw err;
            }

            // Prevent Admins from altering other Admins or Owners (unless actor is Owner or System Admin)
            if (!isOwner && !isSystemAdmin && actorMember?.role === 'Admin' && ['Owner', 'Admin'].includes(targetMember.role)) {
                const err = new Error('Admins cannot change roles of owners or other admins');
                err.status = 403;
                throw err;
            }

            const actualUserId = targetMember.userId?._id || targetMember.userId;
            return await this.organizationRepository.updateMemberRole(org._id, actualUserId, newRole);
        } catch (error) {
            logger.error('Error in updateMemberRole', { orgId, memberOrUserId, newRole, actorId, error: error.message });
            throw error;
        }
    }

    async getPendingInvites(orgId, actorId) {
        try {
            const org = await this.organizationRepository.findById(orgId);
            if (!org) {
                throw new Error('Organization not found');
            }

            const actorMember = org.members.find(m => m.userId._id.toString() === actorId.toString());
            if (!actorMember || !['Owner', 'Admin', 'Manager'].includes(actorMember.role)) {
                throw new Error('Unauthorized');
            }

            return await this.invitationRepository.findPendingByOrgId(orgId);
        } catch (error) {
            logger.error('Error in getPendingInvites', { orgId, error: error.message });
            throw error;
        }
    }
}

export default OrganizationService;
