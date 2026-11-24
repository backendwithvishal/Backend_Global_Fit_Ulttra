import mongoose from 'mongoose';
import { Organization } from '../../models/index.js';
import { logger } from '../../config/logger.js';

export class OrganizationRepository {
    async create(orgData) {
        try {
            const org = new Organization(orgData);
            await org.save();
            logger.info('Organization created', { orgId: org._id, slug: org.slug });
            return org;
        } catch (error) {
            logger.error('Error in OrganizationRepository.create', { error: error.message });
            throw error;
        }
    }

    async findById(id) {
        try {
            if (!id) return null;
            if (mongoose.isValidObjectId(id)) {
                return await Organization.findById(id).populate('members.userId', 'email firstName lastName');
            }
            return await Organization.findOne({ slug: id }).populate('members.userId', 'email firstName lastName');
        } catch (error) {
            logger.error('Error in OrganizationRepository.findById', { id, error: error.message });
            throw error;
        }
    }

    async findBySlug(slug) {
        try {
            return await Organization.findOne({ slug }).populate('members.userId', 'email firstName lastName');
        } catch (error) {
            logger.error('Error in OrganizationRepository.findBySlug', { slug, error: error.message });
            throw error;
        }
    }

    async findByUserId(userId) {
        try {
            return await Organization.find({ 'members.userId': userId }).populate('members.userId', 'email firstName lastName');
        } catch (error) {
            logger.error('Error in OrganizationRepository.findByUserId', { userId, error: error.message });
            throw error;
        }
    }

    async addMember(orgId, userId, role = 'Member') {
        try {
            const org = await Organization.findByIdAndUpdate(
                orgId,
                { $push: { members: { userId, role, joinedAt: new Date() } } },
                { new: true }
            );
            logger.info('Member added to organization', { orgId, userId, role });
            return org;
        } catch (error) {
            logger.error('Error in OrganizationRepository.addMember', { orgId, userId, error: error.message });
            throw error;
        }
    }

    async removeMember(orgId, userId) {
        try {
            const org = await Organization.findByIdAndUpdate(
                orgId,
                { $pull: { members: { userId } } },
                { new: true }
            );
            logger.info('Member removed from organization', { orgId, userId });
            return org;
        } catch (error) {
            logger.error('Error in OrganizationRepository.removeMember', { orgId, userId, error: error.message });
            throw error;
        }
    }

    async updateMemberRole(orgId, userId, role) {
        try {
            const org = await Organization.findOneAndUpdate(
                { _id: orgId, 'members.userId': userId },
                { $set: { 'members.$.role': role } },
                { new: true }
            );
            logger.info('Member role updated', { orgId, userId, role });
            return org;
        } catch (error) {
            logger.error('Error in OrganizationRepository.updateMemberRole', { orgId, userId, error: error.message });
            throw error;
        }
    }

    async update(orgId, updateData) {
        try {
            const org = await Organization.findByIdAndUpdate(
                orgId,
                { $set: updateData },
                { new: true, runValidators: true }
            );
            return org;
        } catch (error) {
            logger.error('Error in OrganizationRepository.update', { orgId, error: error.message });
            throw error;
        }
    }

    async delete(orgId) {
        try {
            return await Organization.findByIdAndDelete(orgId);
        } catch (error) {
            logger.error('Error in OrganizationRepository.delete', { orgId, error: error.message });
            throw error;
        }
    }
}

export default OrganizationRepository;
