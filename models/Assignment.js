import mongoose from 'mongoose';

const assignmentSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    dueDate: {
        type: Date,
        required: true
    },
    closeDate: {
        type: Date,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isGeneral: {
        type: Boolean,
        default: false
    },
    assignedTo: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed'],
        default: 'pending'
    },
    completedAt: {
        type: Date
    },
    attachments: [{
        fileName: String,
        fileUrl: String,
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    }],
    originalAssignmentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Assignment',
        default: null
    },
    responses: [{
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        files: [{
            fileName: String,
            fileUrl: String,
            uploadedAt: {
                type: Date,
                default: Date.now
            }
        }],
        submittedAt: {
            type: Date,
            default: Date.now
        },
        submissionStatus: {
            type: String,
            enum: ['on-time', 'late', 'closed'],
            default: 'on-time'
        },
        status: {
            type: String,
            enum: ['submitted', 'reviewed'],
            default: 'submitted'
        }
    }]
});

export default mongoose.model('Assignment', assignmentSchema); 