import mongoose from 'mongoose';
import Assignment from './Assignment.js';

const teacherStatsSchema = new mongoose.Schema({
    teacher: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    stats: {
        completed: {
            type: Number,
            default: 0
        },
        pending: {
            type: Number,
            default: 0
        },
        overdue: {
            type: Number,
            default: 0
        },
        total: {
            type: Number,
            default: 0
        }
    },
    lastUpdated: {
        type: Date,
        default: Date.now
    }
});

// Método estático para actualizar las estadísticas de un profesor
teacherStatsSchema.statics.updateTeacherStats = async function(teacherId) {
    const now = new Date();
    
    // Obtener todas las asignaciones del profesor
    const assignments = await Assignment.find({
        assignedTo: teacherId
    });

    // Calcular estadísticas considerando las respuestas individuales
    let completed = 0;
    let pending = 0;
    let overdue = 0;

    for (const assignment of assignments) {
        // Buscar la respuesta específica del docente
        const teacherResponse = assignment.responses.find(
            r => r.user.toString() === teacherId.toString()
        );

        if (teacherResponse) {
            if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'on-time') {
                completed++;
            } else if (teacherResponse.status === 'submitted' && teacherResponse.submissionStatus === 'late') {
                completed++;  // También cuenta como completado aunque sea tarde
            } else if (teacherResponse.submissionStatus === 'closed' || (teacherResponse.status === 'reviewed' && !teacherResponse.submittedAt)) {
                overdue++;
            } else {
                pending++;
            }
        } else {
            // Si no hay respuesta, verificar fecha de vencimiento
            if (new Date(assignment.dueDate) > now) {
                pending++;
            } else {
                overdue++;
            }
        }
    }

    const stats = {
        total: assignments.length,
        completed: completed,
        pending: pending,
        overdue: overdue
    };

    // Actualizar o crear el documento de estadísticas
    const teacherStats = await this.findOneAndUpdate(
        { teacher: teacherId },
        { 
            $set: {
                stats: stats,
                lastUpdated: now
            }
        },
        { 
            new: true,
            upsert: true
        }
    );

    return teacherStats;
};

export default mongoose.model('TeacherStats', teacherStatsSchema); 