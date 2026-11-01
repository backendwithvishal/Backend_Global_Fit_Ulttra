export class OrganizationController {
    constructor({ organizationService }) {
        this.organizationService = organizationService;
    }

    async createOrg(req, res, next) {
        try {
            const { name } = req.body;
            const ownerId = req.user.userId;

            if (!name) {
                return res.status(400).json({ error: 'Organization name is required', requestId: req.requestId });
            }

            const org = await this.organizationService.createOrganization(ownerId, name);
            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                org
            });
        } catch (error) {
            next(error);
        }
    }

    async getOrg(req, res, next) {
        try {
            const org = await this.organizationService.getOrganization(req.params.id);
            if (!org) {
                return res.status(404).json({ error: 'Organization not found', requestId: req.requestId });
            }

            const callerId = req.user.userId.toString();
            const isMember = org.members && org.members.some(m => {
                const memberId = (m.userId?._id || m.userId)?.toString();
                return memberId === callerId;
            });
            const isAdmin = req.user.role?.toLowerCase() === 'admin';

            if (!isMember && !isAdmin) {
                return res.status(403).json({
                    error: 'Forbidden: You do not have access to this organization',
                    requestId: req.requestId
                });
            }

            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                org
            });
        } catch (error) {
            next(error);
        }
    }

    async getUserOrgs(req, res, next) {
        try {
            const userId = req.user.userId;
            const orgs = await this.organizationService.getUserOrganizations(userId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                orgs
            });
        } catch (error) {
            next(error);
        }
    }

    async inviteMember(req, res, _next) {
        try {
            const { orgId } = req.params;
            const { email, role } = req.body;
            const invitedById = req.user.userId;

            if (!email) {
                return res.status(400).json({ error: 'Invite email is required', requestId: req.requestId });
            }

            const invite = await this.organizationService.inviteMember(orgId, invitedById, email, role);
            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Invitation sent successfully.',
                invite
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async acceptInvite(req, res, _next) {
        try {
            const { token } = req.body;
            const userId = req.user.userId;

            if (!token) {
                return res.status(400).json({ error: 'Invitation token is required', requestId: req.requestId });
            }

            const org = await this.organizationService.acceptInvitation(token, userId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Joined organization successfully.',
                org
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async removeMember(req, res, _next) {
        try {
            const { orgId, userId } = req.params;
            const actorId = req.user.userId;

            const org = await this.organizationService.removeMember(orgId, userId, actorId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Member removed successfully.',
                org
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async updateMemberRole(req, res, _next) {
        try {
            const { orgId, userId } = req.params;
            const { role } = req.body;
            const actorId = req.user.userId;

            if (!role) {
                return res.status(400).json({ error: 'Role is required', requestId: req.requestId });
            }

            const org = await this.organizationService.updateMemberRole(orgId, userId, role, actorId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'Member role updated successfully.',
                org
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }

    async getPendingInvites(req, res, _next) {
        try {
            const { orgId } = req.params;
            const actorId = req.user.userId;
            const invites = await this.organizationService.getPendingInvites(orgId, actorId);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                invites
            });
        } catch (error) {
            res.status(400).json({ error: error.message, requestId: req.requestId });
        }
    }
}

export default OrganizationController;
