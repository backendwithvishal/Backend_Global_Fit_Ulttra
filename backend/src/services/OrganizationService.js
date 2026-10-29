import crypto from 'crypto';
import { logger } from '../config/logger.js';

export class OrganizationService {
    constructor({ organizationRepository, invitationRepository, userRepository }) {
        this.organizationRepository = organizationRepository;
        this.invitationRepository = invitationRepository;
        this.userRepository = userRepository;
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
                throw new Error('Organization not found');
            }

            // Check if invitedById is Owner or Admin
            const actorMember = org.members.find(m => m.userId._id.toString() === invitedById.toString());
            if (!actorMember || !['Owner', 'Admin'].includes(actorMember.role)) {
                throw new Error('Unauthorized. Only Owners and Admins can invite members.');
            }

            // Check if email already in organization
            const isAlreadyMember = org.members.some(m => m.userId.email.toLowerCase() === email.toLowerCase());
            if (isAlreadyMember) {
                throw new Error('User is already a member of this organization');
            }

            // Check if active pending invitation exists
            const existingInvite = await this.invitationRepository.findByEmailAndOrg(email, orgId);
            if (existingInvite) {
                throw new Error('An active invitation is already pending for this user');
            }

            const token = crypto.randomBytes(32).toString('hex');
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 7); // 7 days expiration

            const invite = await this.invitationRepository.create({
                organizationId: orgId,
                email,
                role,
                token,
                invitedById,
                expiresAt,
            });

            logger.info('[MAILER MOCK] Invitation link generated', { orgName: org.name, email });
            return invite;
        } catch (error) {
            logger.error('Error in inviteMember', { orgId, email, error: error.message });
            throw error;
        }
    }

    async acceptInvitation(token, userId) {
        try {
            const invite = await this.invitationRepository.findByToken(token);
            if (!invite) {
                throw new Error('Invalid or expired invitation token');
            }

            if (new Date() > invite.expiresAt) {
                await this.invitationRepository.updateStatus(invite._id, 'Expired');
                throw new Error('Invitation has expired');
            }

            const user = await this.userRepository.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
                throw new Error('Invitation email does not match logged-in user');
            }

            // Add user to organization
            const org = await this.organizationRepository.addMember(invite.organizationId._id, userId, invite.role);
            
            // Mark invitation accepted
            await this.invitationRepository.updateStatus(invite._id, 'Accepted');

            logger.info('Invitation accepted successfully', { orgId: invite.organizationId._id, userId });
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

    async updateMemberRole(orgId, userId, newRole, actorId) {
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

            // Prevent altering the Owner's role
            if (targetMember.role === 'Owner') {
                throw new Error('Cannot change the role of the organization owner');
            }

            // Prevent Admins from altering other Admins or Owners
            if (actorMember.role === 'Admin' && ['Owner', 'Admin'].includes(targetMember.role)) {
                throw new Error('Admins cannot change roles of owners or other admins');
            }

            return await this.organizationRepository.updateMemberRole(orgId, userId, newRole);
        } catch (error) {
            logger.error('Error in updateMemberRole', { orgId, userId, newRole, actorId, error: error.message });
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
