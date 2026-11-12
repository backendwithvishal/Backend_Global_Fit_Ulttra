export class ApiKeyController {
    constructor({ apiKeyService, organizationRepository }) {
        this.apiKeyService = apiKeyService;
        this.organizationRepository = organizationRepository;
    }

    async createKey(req, res, next) {
        try {
            const { name, organizationId, scopes } = req.body;
            const userId = req.user.userId;

            if (!name || !organizationId) {
                return res.status(400).json({ error: 'Name and organizationId are required', requestId: req.requestId });
            }

            // Verify caller has permissions in target organization
            if (this.organizationRepository) {
                const org = await this.organizationRepository.findById(organizationId);
                if (!org) {
                    return res.status(404).json({ error: 'Organization not found', requestId: req.requestId });
                }
                const isOrgMember = org.members && org.members.some(m => {
                    const memberId = (m.userId?._id || m.userId)?.toString();
                    return memberId === userId.toString() && ['Owner', 'Admin'].includes(m.role);
                });
                if (!isOrgMember && req.user.role !== 'Admin') {
                    return res.status(403).json({ error: 'Forbidden: Insufficient organization privileges to generate API key', requestId: req.requestId });
                }
            } else if (req.user.organizationId && req.user.organizationId.toString() !== organizationId.toString() && req.user.role !== 'Admin') {
                return res.status(403).json({ error: 'Forbidden: Cannot create API key for another organization', requestId: req.requestId });
            }

            const result = await this.apiKeyService.generateKey(userId, organizationId, name, scopes);
            res.status(201).json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'API key created successfully. Save it now, it will not be shown again.',
                apiKey: result.apiKey,
                plainTextKey: result.plainTextKey
            });
        } catch (error) {
            next(error);
        }
    }

    async getKeys(req, res, next) {
        try {
            const { orgId } = req.query;
            let keys = [];
            if (orgId) {
                // Tenancy guard: verify caller belongs to orgId or is Admin
                if (this.organizationRepository) {
                    const org = await this.organizationRepository.findById(orgId);
                    if (!org) {
                        return res.status(404).json({ error: 'Organization not found', requestId: req.requestId });
                    }
                    const isMember = org.members && org.members.some(m => {
                        const memberId = (m.userId?._id || m.userId)?.toString();
                        return memberId === req.user.userId.toString();
                    });
                    if (!isMember && req.user.role !== 'Admin') {
                        return res.status(403).json({ error: 'Forbidden: You do not belong to this organization', requestId: req.requestId });
                    }
                } else if (req.user.organizationId && req.user.organizationId.toString() !== orgId.toString() && req.user.role !== 'Admin') {
                    return res.status(403).json({ error: 'Forbidden: Access to organization keys denied', requestId: req.requestId });
                }
                keys = await this.apiKeyService.getOrganizationKeys(orgId);
            } else {
                keys = await this.apiKeyService.getUserKeys(req.user.userId);
            }

            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                keys
            });
        } catch (error) {
            next(error);
        }
    }

    async deactivateKey(req, res, next) {
        try {
            const { id } = req.params;
            const existingKey = await this.apiKeyService.getKeyById(id);
            if (!existingKey) {
                return res.status(404).json({ error: 'API key not found', requestId: req.requestId });
            }

            // Verify caller created the key or is an Admin of the organization
            const isCreator = existingKey.userId && (existingKey.userId._id || existingKey.userId).toString() === req.user.userId.toString();
            let isOrgAdmin = false;
            if (this.organizationRepository && existingKey.organizationId) {
                const orgId = existingKey.organizationId._id || existingKey.organizationId;
                const org = await this.organizationRepository.findById(orgId);
                if (org && org.members) {
                    isOrgAdmin = org.members.some(m => {
                        const memberId = (m.userId?._id || m.userId)?.toString();
                        return memberId === req.user.userId.toString() && ['Owner', 'Admin'].includes(m.role);
                    });
                }
            }

            if (!isCreator && !isOrgAdmin && req.user.role !== 'Admin') {
                return res.status(403).json({ error: 'Forbidden: You do not have permission to deactivate this API key', requestId: req.requestId });
            }

            const apiKey = await this.apiKeyService.deactivateKey(id);
            res.json({
                requestId: req.requestId,
                timestamp: new Date().toISOString(),
                message: 'API Key deactivated successfully.',
                apiKey
            });
        } catch (error) {
            next(error);
        }
    }
}

export default ApiKeyController;
